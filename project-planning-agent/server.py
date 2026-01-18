"""FastAPI server using AG-UI Protocol SDK for event streaming.

This is the Translation Layer between LangChain v1 agent and AG-UI protocol.
"""

import os
import uuid
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv()

# AG-UI Protocol SDK imports
from ag_ui.core import (
    RunAgentInput,
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    StateSnapshotEvent,
    StateDeltaEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallEndEvent,
)
from ag_ui.encoder import EventEncoder

from schema import PlannerState, Column, Task, VisualTone, LoadLevel, TaskType, TaskStatus
from agent_logic import create_planner_agent


app = FastAPI(title="Rolling 3-Day Planner Agent")

# CORS configuration from environment
cors_origins = os.getenv("CORS_ORIGINS", "*")
if cors_origins == "*":
    allow_origins = ["*"]
else:
    allow_origins = [origin.strip() for origin in cors_origins.split(",")]

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global state storage (in production, use Redis or database)
_state_store: Dict[str, PlannerState] = {}


def get_or_create_state(thread_id: str) -> PlannerState:
    """Get existing state or create default state for a thread."""
    if thread_id not in _state_store:
        _state_store[thread_id] = PlannerState(
            global_tone=VisualTone.NEUTRAL,
            columns={
                "today": Column(
                    id="today",
                    label="Today",
                    load_level=LoadLevel.LIGHT,
                    tasks=[]
                ),
                "tomorrow": Column(
                    id="tomorrow",
                    label="Tomorrow",
                    load_level=LoadLevel.LIGHT,
                    tasks=[]
                ),
                "next": Column(
                    id="next",
                    label="Next Day",
                    load_level=LoadLevel.LIGHT,
                    tasks=[]
                ),
            }
        )
    return _state_store[thread_id]


def update_state(thread_id: str, state: PlannerState):
    """Update the state for a thread."""
    _state_store[thread_id] = state


# =============================================================================
# STATE INTERCEPTORS - Generate JSON Patches from tool results
# =============================================================================

def generate_move_task_delta(
    current_state: PlannerState,
    task_id: str,
    target_day: str,
    target_index: int = -1
) -> List[Dict[str, Any]]:
    """
    Generate JSON Patch for moving a task.
    
    Returns:
        List of JSON Patch operations (RFC 6902)
    """
    # Find the task in the current state
    source_column = None
    task_index = None
    task_data = None
    
    for col_key, column in current_state.columns.items():
        for idx, task in enumerate(column.tasks):
            if task.id == task_id:
                source_column = col_key
                task_index = idx
                task_data = task
                break
        if source_column:
            break
    
    if source_column is None or task_data is None:
        return []  # Task not found
    
    # Cannot move fixed tasks
    if task_data.type == TaskType.FIXED:
        return []
    
    # Don't move if already in target
    if source_column == target_day:
        return []
    
    # Generate the move operation
    from_path = f"/columns/{source_column}/tasks/{task_index}"
    to_path = f"/columns/{target_day}/tasks/-"  # '-' appends to end
    
    return [{
        "op": "move",
        "from": from_path,
        "path": to_path
    }]


def generate_add_task_delta(
    day: str,
    task: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Generate JSON Patch for adding a new task.
    
    Returns:
        List of JSON Patch operations
    """
    return [{
        "op": "add",
        "path": f"/columns/{day}/tasks/-",
        "value": task
    }]


def generate_set_tone_delta(
    tone: str
) -> List[Dict[str, Any]]:
    """
    Generate JSON Patch for changing visual tone.
    
    Returns:
        List of JSON Patch operations
    """
    return [{
        "op": "replace",
        "path": "/global_tone",
        "value": tone
    }]


def generate_mark_status_delta(
    current_state: PlannerState,
    task_id: str,
    new_status: str
) -> List[Dict[str, Any]]:
    """
    Generate JSON Patch for marking task status.
    
    Returns:
        List of JSON Patch operations
    """
    # Find the task
    for col_key, column in current_state.columns.items():
        for idx, task in enumerate(column.tasks):
            if task.id == task_id:
                return [{
                    "op": "replace",
                    "path": f"/columns/{col_key}/tasks/{idx}/status",
                    "value": new_status
                }]
    
    return []  # Task not found


def apply_delta_to_state(state: PlannerState, delta: List[Dict[str, Any]]) -> PlannerState:
    """
    Apply JSON Patch to state and return updated state.
    """
    import jsonpatch
    state_dict = state.model_dump()
    patched = jsonpatch.apply_patch(state_dict, delta)
    return PlannerState(**patched)


# =============================================================================
# AG-UI EVENT STREAMING
# =============================================================================

async def stream_agent_events(input_data: RunAgentInput):
    """
    Stream AG-UI protocol events from the agent execution.
    
    This is the Translation Layer between LangChain agent and AG-UI protocol.
    """
    encoder = EventEncoder()
    thread_id = input_data.thread_id
    run_id = input_data.run_id
    
    # Get or create current state
    current_state = get_or_create_state(thread_id)
    
    # Update state if provided in input (e.g., from optimistic UI update)
    if input_data.state:
        current_state = PlannerState(**input_data.state)
        update_state(thread_id, current_state)
    
    # 1. Emit RUN_STARTED
    yield encoder.encode(
        RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=thread_id,
            run_id=run_id
        )
    )
    
    # 2. Emit STATE_SNAPSHOT (initial state)
    yield encoder.encode(
        StateSnapshotEvent(
            type=EventType.STATE_SNAPSHOT,
            snapshot=current_state.model_dump()
        )
    )
    
    try:
        # Create agent
        agent = create_planner_agent()
        
        # Convert AG-UI messages to LangChain format
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        
        # Inject current state context so agent knows if plan is empty
        state_context = f"""Current Plan State:
{current_state.model_dump_json(indent=2)}

Note: If the plan has no tasks (empty tasks arrays), use set_full_plan to initialize it."""
        
        langchain_messages = [SystemMessage(content=state_context)]
        
        for msg in input_data.messages:
            if msg.role == "user":
                langchain_messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                langchain_messages.append(AIMessage(content=msg.content))
        
        # Track pending tool calls for STATE_DELTA generation
        pending_tool_calls: Dict[str, Dict[str, Any]] = {}
        message_id = str(uuid.uuid4())
        text_message_started = False  # Track if we've sent TEXT_MESSAGE_START
        
        # Stream Content Blocks from agent.stream()
        # agent.stream() returns a regular generator - use regular for loop
        # (can use regular for inside async generator function)
        from langchain_core.messages import ToolMessage
        
        for chunk in agent.stream(
            {"messages": langchain_messages},
            stream_mode="updates"
        ):
            # Process each step update
            for step_name, step_data in chunk.items():
                messages = step_data.get("messages", [])
                if not messages:
                    continue
                
                # Get the last message from this step
                last_message = messages[-1]
                
                # Handle AIMessage - check for tool_calls and text content
                if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                    # Tool calls in AIMessage
                    for tc in last_message.tool_calls:
                        tool_name = tc.get('name', '') if isinstance(tc, dict) else getattr(tc, 'name', '')
                        tool_args = tc.get('args', {}) if isinstance(tc, dict) else getattr(tc, 'args', {})
                        tool_call_id = tc.get('id', str(uuid.uuid4())) if isinstance(tc, dict) else getattr(tc, 'id', str(uuid.uuid4()))
                        
                        # Store tool call info for STATE_DELTA generation
                        pending_tool_calls[tool_call_id] = {
                            "name": tool_name,
                            "args": tool_args
                        }
                        
                        yield encoder.encode(
                            ToolCallStartEvent(
                                type=EventType.TOOL_CALL_START,
                                tool_call_id=tool_call_id,
                                tool_call_name=tool_name,
                                tool_call_args=tool_args if isinstance(tool_args, dict) else {}
                            )
                        )
                
                # Handle text content from AIMessage
                if hasattr(last_message, 'content') and last_message.content:
                    text_content = last_message.content
                    if isinstance(text_content, str) and text_content.strip():
                        # Start text message if not already started
                        if not text_message_started:
                            yield encoder.encode(
                                TextMessageStartEvent(
                                    type=EventType.TEXT_MESSAGE_START,
                                    message_id=message_id,
                                    role="assistant"
                                )
                            )
                            text_message_started = True
                        
                        yield encoder.encode(
                            TextMessageContentEvent(
                                type=EventType.TEXT_MESSAGE_CONTENT,
                                message_id=message_id,
                                delta=text_content
                            )
                        )
                    elif isinstance(text_content, list):
                        # Content blocks list
                        for block in text_content:
                            if isinstance(block, dict) and block.get('type') == 'text':
                                text = block.get('text', '')
                                if text:
                                    # Start text message if not already started
                                    if not text_message_started:
                                        yield encoder.encode(
                                            TextMessageStartEvent(
                                                type=EventType.TEXT_MESSAGE_START,
                                                message_id=message_id,
                                                role="assistant"
                                            )
                                        )
                                        text_message_started = True
                                    
                                    yield encoder.encode(
                                        TextMessageContentEvent(
                                            type=EventType.TEXT_MESSAGE_CONTENT,
                                            message_id=message_id,
                                            delta=text
                                        )
                                    )
                
                # Handle ToolMessage - tool execution results
                if isinstance(last_message, ToolMessage):
                    tool_call_id = last_message.tool_call_id if hasattr(last_message, 'tool_call_id') else ''
                    result_content = last_message.content if hasattr(last_message, 'content') else ''
                    
                    yield encoder.encode(
                        ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=tool_call_id,
                            tool_call_result=str(result_content) if result_content else ""
                        )
                    )
                    
                    # STATE INTERCEPTOR: Convert actuator results to STATE_DELTA
                    if tool_call_id and tool_call_id in pending_tool_calls:
                        tool_info = pending_tool_calls[tool_call_id]
                        tool_name = tool_info["name"]
                        tool_args = tool_info["args"]
                        
                        delta = []
                        
                        # Parse result to check success
                        try:
                            import json
                            result_dict = json.loads(result_content) if isinstance(result_content, str) else result_content
                            if isinstance(result_dict, dict) and result_dict.get("status") == "success":
                                
                                # Generate STATE_DELTA based on tool
                                if tool_name == "move_task_in_plan":
                                    delta = generate_move_task_delta(
                                        current_state,
                                        tool_args.get("task_id", ""),
                                        tool_args.get("target_day", ""),
                                        tool_args.get("target_index", -1)
                                    )
                                
                                elif tool_name == "add_task_to_plan":
                                    task = result_dict.get("task", {})
                                    day = result_dict.get("day", tool_args.get("day", "today"))
                                    if task:
                                        delta = generate_add_task_delta(day, task)
                                
                                elif tool_name == "set_visual_tone":
                                    tone = result_dict.get("tone", tool_args.get("tone", ""))
                                    if tone:
                                        delta = generate_set_tone_delta(tone)
                                
                                elif tool_name == "mark_task_status":
                                    new_status = result_dict.get("new_status", tool_args.get("status", ""))
                                    task_id = tool_args.get("task_id", "")
                                    if new_status and task_id:
                                        delta = generate_mark_status_delta(current_state, task_id, new_status)
                                
                                elif tool_name == "set_full_plan":
                                    # Full plan replacement - emit new STATE_SNAPSHOT
                                    plan = result_dict.get("plan", {})
                                    if plan:
                                        current_state = PlannerState(**plan)
                                        update_state(thread_id, current_state)
                                        
                                        # Emit STATE_SNAPSHOT for full replacement
                                        yield encoder.encode(
                                            StateSnapshotEvent(
                                                type=EventType.STATE_SNAPSHOT,
                                                snapshot=current_state.model_dump()
                                            )
                                        )
                                        # Skip normal delta emission for this tool
                                        del pending_tool_calls[tool_call_id]
                                        continue
                                
                                # Emit STATE_DELTA if we have patches
                                if delta:
                                    # Apply to local state for subsequent operations
                                    current_state = apply_delta_to_state(current_state, delta)
                                    update_state(thread_id, current_state)
                                    
                                    yield encoder.encode(
                                        StateDeltaEvent(
                                            type=EventType.STATE_DELTA,
                                            delta=delta
                                        )
                                    )
                        except (json.JSONDecodeError, TypeError):
                            pass  # Tool result wasn't JSON, skip STATE_DELTA
                        
                        # Clean up
                        del pending_tool_calls[tool_call_id]
        
        # 3. Emit TEXT_MESSAGE_END if we started a text message
        if text_message_started:
            yield encoder.encode(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=message_id
                )
            )
        
        # 4. Emit RUN_FINISHED
        yield encoder.encode(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id
            )
        )
        
    except Exception as e:
        import traceback
        error_message_id = str(uuid.uuid4())
        
        # Emit error as text message with proper lifecycle
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=error_message_id,
                role="assistant"
            )
        )
        yield encoder.encode(
            TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=error_message_id,
                delta=f"Error: {str(e)}\n{traceback.format_exc()}"
            )
        )
        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=error_message_id
            )
        )
        
        # Still emit RUN_FINISHED
        yield encoder.encode(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id
            )
        )


@app.post("/agent")
async def run_agent(request: Request):
    """
    Run the agent and stream AG-UI protocol events.
    
    Accepts RunAgentInput and returns SSE stream of AG-UI events.
    """
    try:
        body = await request.body()
        input_data = RunAgentInput.model_validate_json(body)
        
        return StreamingResponse(
            stream_agent_events(input_data),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in /agent endpoint: {e}")
        print(error_details)
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}\n{error_details}")


@app.get("/agent/state/{thread_id}")
async def get_state_snapshot(thread_id: str):
    """
    Get the current state snapshot for a thread (REST endpoint).
    
    Returns SSE stream with single STATE_SNAPSHOT event.
    """
    encoder = EventEncoder()
    state = get_or_create_state(thread_id)
    
    async def emit_snapshot():
        yield encoder.encode(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state.model_dump()
            )
        )
    
    return StreamingResponse(emit_snapshot(), media_type="text/event-stream")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "protocol": "ag-ui"}


if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", "8000"))
    
    uvicorn.run(app, host=host, port=port)
