"""FastAPI server using AG-UI Protocol SDK for event streaming.

This is the Translation Layer between LangChain v1 agent and AG-UI protocol.
"""

import json
import os
import uuid
import asyncio
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

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
    ToolCallResultEvent,
    ActivitySnapshotEvent,
)
from ag_ui.encoder import EventEncoder

from schema import ExportStatus, PlannerState, Column, Task, VisualTone, LoadLevel, TaskType, TaskStatus, ExportSession
from agent_logic import create_planner_agent
from pydantic import BaseModel


def _normalize_duration(duration) -> int:
    """
    Convert duration to integer minutes.

    Accepts: "1h" -> 60, "30m" -> 30, "45m" -> 45, 60 -> 60, None -> 30
    """
    if duration is None:
        return 30
    if isinstance(duration, int):
        return duration
    s = str(duration).strip().lower()
    if s.endswith("h"):
        try:
            return int(float(s[:-1]) * 60)
        except ValueError:
            return 30
    if s.endswith("m"):
        try:
            return int(s[:-1])
        except ValueError:
            return 30
    try:
        return int(s)
    except ValueError:
        return 30


def _assign_slot(existing_tasks: list, duration_minutes: int):
    """
    Find the earliest free 15-min-aligned slot on a day, given existing tasks.

    Packs from 09:00, leaves a 15-min buffer after each existing task.
    Returns "HH:MM" string or None if no slot fits before 19:00.

    Args:
        existing_tasks: list of objects with .start_time and .duration_minutes
        duration_minutes: how long the new task needs (already normalized)
    """
    WORK_START = 9 * 60    # 09:00 in minutes
    WORK_END   = 19 * 60   # 19:00 in minutes
    BUFFER     = 15

    intervals = []
    for t in existing_tasks:
        if t.start_time and t.duration_minutes:
            h, m = map(int, t.start_time.split(":"))
            start = h * 60 + m
            intervals.append((start, start + t.duration_minutes))
    intervals.sort()

    cursor = WORK_START
    while cursor + duration_minutes <= WORK_END:
        end = cursor + duration_minutes
        overlap = any(
            not (end + BUFFER <= s or cursor >= e + BUFFER)
            for s, e in intervals
        )
        if not overlap:
            h, m = divmod(cursor, 60)
            return f"{h:02d}:{m:02d}"
        blocking_ends = [e for s, e in intervals if not (end <= s or cursor >= e + BUFFER)]
        if blocking_ends:
            next_try = max(blocking_ends) + BUFFER
            cursor = ((next_try + 14) // 15) * 15
        else:
            cursor += 15
    return None


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
_history_store: Dict[str, List[Dict[str, Any]]] = {}
_export_store: Dict[str, ExportSession] = {}  # thread_id → ExportSession

# Pub/sub for state event subscriptions (in production, use Redis pub/sub)
_subscribers: Dict[str, List[asyncio.Queue]] = {}


# MCP App Registry: maps agent tool names to MCP App metadata
# Adding new MCP Apps here automatically makes them renderable in the frontend
_MCP_APP_REGISTRY: Dict[str, Dict[str, str]] = {
    "todoist_mcp": {
        "resourceUri": "ui://todoist-planner/editor.html",
        "mcpServerUrl": os.getenv("MCP_SERVER_URL"),
    }
}


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


def get_history(thread_id: str) -> List[Dict[str, Any]]:
    """Get conversation history for a thread."""
    return _history_store.get(thread_id, [])


def update_history(thread_id: str, messages: List[Dict[str, Any]]):
    """Update conversation history for a thread."""
    _history_store[thread_id] = messages


async def broadcast_to_subscribers(thread_id: str, event_data: str):
    """Broadcast an event to all subscribers for a thread."""
    if thread_id in _subscribers:
        # Remove dead queues (clients that disconnected)
        active_queues = []
        for queue in _subscribers[thread_id]:
            try:
                queue.put_nowait(event_data)
                active_queues.append(queue)
            except asyncio.QueueFull:
                # Queue full, skip this subscriber
                pass
            except Exception:
                # Queue closed or other error, remove it
                pass
        _subscribers[thread_id] = active_queues


# =============================================================================
# STATE INTERCEPTORS - Generate JSON Patches from tool results
# =============================================================================

def generate_move_task_delta(
    current_state: PlannerState,
    task_id: str,
    target_day: str,
    target_index: int = -1,
    start_time: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Generate JSON Patch for moving a task.
    
    Returns:
        List of JSON Patch operations (RFC 6902)
    """
    # Debug: log the state we're searching through
    all_task_ids = {
        col_key: [t.id for t in col.tasks]
        for col_key, col in current_state.columns.items()
    }
    logger.info(
        "generate_move_task_delta: looking for task_id=%s target_day=%s in state=%s",
        task_id,
        target_day,
        all_task_ids,
    )

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
        logger.warning("generate_move_task_delta: task_id=%s NOT FOUND in any column", task_id)
        return []  # Task not found
    
    # Cannot move fixed tasks
    if task_data.type == TaskType.FIXED:
        logger.warning("generate_move_task_delta: task_id=%s is FIXED, cannot move", task_id)
        return []
    
    # Already in target column — still allow a start_time update
    if source_column == target_day:
        if start_time and start_time != task_data.start_time:
            logger.info(
                "generate_move_task_delta: task_id=%s already in %s, updating start_time %s → %s",
                task_id, target_day, task_data.start_time, start_time,
            )
            return [{
                "op": "replace",
                "path": f"/columns/{target_day}/tasks/{task_index}/start_time",
                "value": start_time,
            }]
        logger.info(
            "generate_move_task_delta: task_id=%s already in %s with same time, true no-op",
            task_id, target_day,
        )
        return []
    
    # Generate the move operation
    from_path = f"/columns/{source_column}/tasks/{task_index}"
    to_path = f"/columns/{target_day}/tasks/-"  # '-' appends to end
    
    patches = [{
        "op": "move",
        "from": from_path,
        "path": to_path
    }]
    
    # If a new start_time was provided, patch it on the newly appended task
    if start_time:
        target_len = len(current_state.columns[target_day].tasks)
        patches.append({
            "op": "replace",
            "path": f"/columns/{target_day}/tasks/{target_len}/start_time",
            "value": start_time
        })
    
    return patches


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
# ACTION API MODELS
# =============================================================================


class ActionRequest(BaseModel):
    thread_id: str
    action: str
    payload: Dict[str, Any]


# =============================================================================
# TODOIST MCP INTERCEPTOR
# =============================================================================

async def _handle_todoist_interceptor(
    thread_id: str,
    current_state: PlannerState,
    result_content: str,
    tool_info: Dict[str, Any],
) -> str:
    """
    Intercept todoist_mcp tool signals and call the MCP server.
    Returns the enriched result string for TOOL_CALL_END.
    """
    import json
    import httpx
    from datetime import datetime
    from tools.todoist import compute_snapshot

    try:
        signal = json.loads(result_content) if isinstance(result_content, str) else result_content
    except (json.JSONDecodeError, TypeError):
        return str(result_content)

    if not isinstance(signal, dict) or signal.get("action") != "export_to_todoist":
        return str(result_content)

    project_name = signal.get("project_name", "3-Day Plan")
    project_id = signal.get("project_id", "")

    # Check for existing export session
    if not project_id and thread_id in _export_store:
        existing = _export_store[thread_id]
        if existing.todoist_project_id:
            project_id = existing.todoist_project_id

    # Compute snapshot from current planner state
    snapshot = compute_snapshot(current_state, thread_id)

    # Check for empty plan
    total_tasks = sum(len(day.tasks) for day in snapshot.days.values())
    if total_tasks == 0:
        return json.dumps({
            "status": "error",
            "error_type": "empty_plan",
            "message": "No active tasks to export. Add some tasks to your plan first.",
        })

    # Call MCP server
    mcp_url = _MCP_APP_REGISTRY.get("todoist_mcp", {}).get("mcpServerUrl")
    if not mcp_url:
        return json.dumps({
            "status": "error",
            "error_type": "missing_mcp_server_url",
            "message": "MCP_SERVER_URL is not set. Configure it via environment variables.",
        })

    mcp_args: Dict[str, Any] = {
        "project_name": project_name,
        "snapshot": {
            "days": {
                day_key: {
                    "day": day.day,
                    "label": day.label,
                    "tasks": [
                        {
                            "planner_id": t.planner_id,
                            "title": t.title,
                            "type": t.type,
                            "order": t.order,
                            **({"source": t.source} if t.source else {}),
                            **({"duration": t.duration} if t.duration else {}),
                        }
                        for t in day.tasks
                    ],
                }
                for day_key, day in snapshot.days.items()
            }
        },
    }
    if project_id:
        mcp_args["project_id"] = project_id

    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {
            "name": "write_plan_to_todoist",
            "arguments": mcp_args,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                mcp_url,
                json=payload,
                headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
            )
            response.raise_for_status()

            # Parse response (may be JSON-RPC or SSE)
            content_type = response.headers.get("content-type", "")
            if "text/event-stream" in content_type:
                mcp_result = None
                for line in response.text.strip().split("\n"):
                    if line.startswith("data: "):
                        try:
                            parsed = json.loads(line[6:])
                            if "result" in parsed:
                                mcp_result = parsed["result"]
                        except json.JSONDecodeError:
                            pass
                if not mcp_result:
                    raise Exception("No valid result in SSE response from MCP server")
            else:
                data = response.json()
                if "error" in data:
                    raise Exception(f"MCP error: {data['error'].get('message', 'Unknown')}")
                mcp_result = data.get("result", data)

        # Parse the tool result text content
        tool_result_text = ""
        if isinstance(mcp_result, dict) and "content" in mcp_result:
            for content_item in mcp_result["content"]:
                if isinstance(content_item, dict) and content_item.get("type") == "text":
                    tool_result_text = content_item["text"]
                    break

        result_dict = json.loads(tool_result_text) if tool_result_text else {}

        # Update export session
        if isinstance(result_dict, dict) and result_dict.get("status") == "success":
            from schema import ExportSession, ExportStatus
            session = ExportSession(
                session_id=str(uuid.uuid4()),
                thread_id=thread_id,
                snapshot_id=snapshot.snapshot_id,
                todoist_project_id=result_dict.get("project_id"),
                todoist_project_name=project_name,
                section_mapping=result_dict.get("sections", {}),
                task_mapping=result_dict.get("task_mapping", {}),
                status=ExportStatus.WRITTEN,
            )
            _export_store[thread_id] = session

            # Enrich with _mcpApp metadata
            tool_name = "todoist_mcp"
            if tool_name in _MCP_APP_REGISTRY:
                result_dict["_mcpApp"] = _MCP_APP_REGISTRY[tool_name]

            return json.dumps(result_dict)
        else:
            # Error from MCP server — update session status
            from schema import ExportStatus
            if thread_id in _export_store:
                _export_store[thread_id].status = ExportStatus.ERROR
                _export_store[thread_id].error = result_dict.get("message", "Unknown error")
            return tool_result_text or json.dumps(result_dict)

    except httpx.ConnectError:
        from schema import ExportStatus
        error_result = {
            "status": "error",
            "error_type": "connection_error",
            "message": "Could not connect to the Todoist MCP server. Make sure it is running on port 3001.",
        }
        if thread_id in _export_store:
            _export_store[thread_id].status = ExportStatus.ERROR
            _export_store[thread_id].error = error_result["message"]
        return json.dumps(error_result)
    except Exception as e:
        from schema import ExportStatus
        error_result = {
            "status": "error",
            "error_type": "api_error",
            "message": f"Failed to export to Todoist: {str(e)}",
        }
        if thread_id in _export_store:
            _export_store[thread_id].status = ExportStatus.ERROR
            _export_store[thread_id].error = str(e)
        return json.dumps(error_result)


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
    # run_id must be stable for the whole run: progress message uses progress:{run_id}
    run_id = input_data.run_id or str(uuid.uuid4())
    logger.info(f"Stream agent events called for thread_id: {thread_id}, run_id: {run_id}")
    # Get or create current state
    current_state = get_or_create_state(thread_id)
    
    # Update state if provided in input (e.g., from optimistic UI update)
    if input_data.state:
        try:
            current_state = PlannerState(**input_data.state)
            update_state(thread_id, current_state)
            task_counts = {k: len(v.tasks) for k, v in current_state.columns.items()}
            logger.info("State from input_data.state: task_counts=%s", task_counts)
        except Exception as e:
            logger.warning("Failed to parse input_data.state, using store state: %s", e)
    else:
        task_counts = {k: len(v.tasks) for k, v in current_state.columns.items()}
        logger.info("State from _state_store (no input_data.state): task_counts=%s", task_counts)
    
    # 1. Emit RUN_STARTED
    run_started_encoded = encoder.encode(
        RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=thread_id,
            run_id=run_id
        )
    )
    yield run_started_encoded
    # Broadcast to subscribers (needed for voice mode)
    await broadcast_to_subscribers(thread_id, run_started_encoded)

    # 1b. Broadcast the user's message immediately so voice-mode subscribers can
    #     display it in the chat before the agent finishes processing.
    if input_data.messages:
        last_msg = input_data.messages[-1]
        role = getattr(last_msg, 'role', None) or (last_msg.get('role') if isinstance(last_msg, dict) else None)
        content = getattr(last_msg, 'content', None) or (last_msg.get('content') if isinstance(last_msg, dict) else None)
        if role == 'user' and content:
            user_msg_event = json.dumps({
                "type": "USER_MESSAGE",
                "content": content,
            })
            user_msg_encoded = f"data: {user_msg_event}\n\n"
            await broadcast_to_subscribers(thread_id, user_msg_encoded)

    # 2. Emit STATE_SNAPSHOT (initial state)
    state_snapshot_event = StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=current_state.model_dump()
    )
    snapshot_encoded = encoder.encode(state_snapshot_event)
    yield snapshot_encoded
    await broadcast_to_subscribers(thread_id, snapshot_encoded)

    # Progress as ACTIVITY_SNAPSHOT (no TEXT_MESSAGE lifecycle → no verify errors).
    progress_message_id = f"progress:{run_id}"
    progress_started = False
    progress_ended = False

    # Initialize before try so except block can safely reference them
    message_id = str(uuid.uuid4())
    text_message_started = False
    assistant_response_text = ""

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

        # Only send the last few turns to the LLM to keep prompts small
        recent_messages = input_data.messages[-5:] if len(input_data.messages) > 5 else input_data.messages
        for msg in recent_messages:
            if msg.role == "user":
                langchain_messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                langchain_messages.append(AIMessage(content=msg.content))
        
        # Track pending tool calls for STATE_DELTA generation
        pending_tool_calls: Dict[str, Dict[str, Any]] = {}
        # message_id, text_message_started, assistant_response_text initialized above
        
        # Stream Content Blocks from agent.stream()
        # agent.stream() returns a regular generator - use regular for loop
        # (can use regular for inside async generator function)
        from langchain_core.messages import ToolMessage

        # Custom progress message per tool (fallback: "Working… {tool_name}")
        PROGRESS_MESSAGES: Dict[str, str] = {
            "fetch_planning_context": "Loading your schedule and emails…",
            "fetch_calendar": "Fetching calendar…",
            "fetch_emails": "Checking your inbox…",
            "set_full_plan": "Building your plan…",
            "move_task_in_plan": "Moving task…",
            "add_task_to_plan": "Adding task…",
            "set_visual_tone": "Updating mood…",
            "mark_task_status": "Updating task status…",
            "todoist_mcp": "Exporting to Todoist…",
        }

        from langchain_core.messages import AIMessageChunk

        async for stream_mode_name, chunk in agent.astream(
            {"messages": langchain_messages},
            stream_mode=["updates", "messages"]
        ):
            # ── "messages" mode: per-token text streaming ──────────────────
            if stream_mode_name == "messages":
                msg_chunk, _meta = chunk
                if not isinstance(msg_chunk, AIMessageChunk):
                    continue
                token = msg_chunk.content
                if not token or not isinstance(token, str):
                    continue
                # Clear progress bubble on first real text token
                if progress_started and not progress_ended:
                    progress_ended = True
                    clear_enc = encoder.encode(
                        ActivitySnapshotEvent(
                            type=EventType.ACTIVITY_SNAPSHOT,
                            messageId=progress_message_id,
                            activityType="PROGRESS",
                            content={"text": ""},
                            replace=True,
                        )
                    )
                    yield clear_enc
                    await broadcast_to_subscribers(thread_id, clear_enc)
                # Open the text message on the first token
                if not text_message_started:
                    yield encoder.encode(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=message_id,
                            role="assistant"
                        )
                    )
                    text_message_started = True
                assistant_response_text += token
                yield encoder.encode(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=message_id,
                        delta=token
                    )   
                )
                await asyncio.sleep(0)  # Yield to event loop so uvicorn flushes the chunk
                continue

            # ── "updates" mode: tool calls + state deltas ──────────────────
            for step_name, step_data in chunk.items():
                messages = step_data.get("messages", [])
                msg_types = [type(m).__name__ for m in messages] if messages else []
                logger.info(
                    "updates step=%s msg_count=%d msg_types=%s",
                    step_name, len(messages), msg_types,
                )
                if not messages:
                    continue
                
                last_message = messages[-1]
                
                # Tool calls emitted by the LLM
                if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                    for tc in last_message.tool_calls:
                        tool_name = tc.get('name', '') if isinstance(tc, dict) else getattr(tc, 'name', '')
                        tool_args = tc.get('args', {}) if isinstance(tc, dict) else getattr(tc, 'args', {})
                        tool_call_id = tc.get('id', str(uuid.uuid4())) if isinstance(tc, dict) else getattr(tc, 'id', str(uuid.uuid4()))

                        pending_tool_calls[tool_call_id] = {
                            "name": tool_name,
                            "args": tool_args
                        }

                        progress_text = PROGRESS_MESSAGES.get(
                            tool_name, f"Working… {tool_name.replace('_', ' ')}"
                        )
                        progress_started = True
                        activity_enc = encoder.encode(
                            ActivitySnapshotEvent(
                                type=EventType.ACTIVITY_SNAPSHOT,
                                messageId=progress_message_id,
                                activityType="PROGRESS",
                                content={"text": progress_text},
                                replace=True,
                            )
                        )
                        yield activity_enc
                        await broadcast_to_subscribers(thread_id, activity_enc)

                        yield encoder.encode(
                            ToolCallStartEvent(
                                type=EventType.TOOL_CALL_START,
                                tool_call_id=tool_call_id,
                                tool_call_name=tool_name,
                                tool_call_args=tool_args if isinstance(tool_args, dict) else {}
                            )
                        )
                
                # Handle ToolMessage - tool execution results
                # Process ALL ToolMessages in this step (agent may run multiple tools in parallel)
                for msg in messages:
                    if not isinstance(msg, ToolMessage):
                        continue
                    tool_call_id = msg.tool_call_id if hasattr(msg, 'tool_call_id') else ''
                    result_content = msg.content if hasattr(msg, 'content') else ''
                    logger.info(
                        "ToolMessage found: tool_call_id=%s in_pending=%s content_preview=%s",
                        tool_call_id,
                        tool_call_id in pending_tool_calls,
                        str(result_content)[:120],
                    )

                    # TODOIST INTERCEPTOR: Handle todoist_mcp signal
                    # Must run BEFORE emitting ToolCallEndEvent so we can enrich the result
                    enriched_result = str(result_content) if result_content else ""
                    if tool_call_id and tool_call_id in pending_tool_calls:
                        tool_info = pending_tool_calls[tool_call_id]
                        logger.info(f"Tool info: {tool_info}")
                        if tool_info["name"] == "todoist_mcp":
                            enriched_result = await _handle_todoist_interceptor(
                                thread_id, current_state, result_content, tool_info
                            )
                            logger.info(f"Enriched result: {enriched_result}")

                    # Emit per AG-UI protocol: TOOL_CALL_END has only tool_call_id.
                    # When result contains _mcpApp, emit TOOL_CALL_RESULT with content
                    # (frontend parses event.content for _mcpApp).
                    try:
                        result_dict = json.loads(enriched_result) if enriched_result else {}
                        has_mcp_app = isinstance(result_dict, dict) and "_mcpApp" in result_dict
                        if has_mcp_app:
                            logger.info(f"Has MCP app: {result_dict}")
                    except (json.JSONDecodeError, TypeError):
                        has_mcp_app = False

                    if has_mcp_app:
                        yield encoder.encode(
                            ToolCallEndEvent(
                                type=EventType.TOOL_CALL_END,
                                tool_call_id=tool_call_id,
                            )
                        )
                        tool_result_msg_id = str(uuid.uuid4())
                        tool_result_encoded = encoder.encode(
                            ToolCallResultEvent(
                                type=EventType.TOOL_CALL_RESULT,
                                message_id=tool_result_msg_id,
                                tool_call_id=tool_call_id,
                                content=enriched_result,
                                role="tool",
                            )
                        )
                        yield tool_result_encoded
                        await broadcast_to_subscribers(thread_id, tool_result_encoded)
                    else:
                        yield encoder.encode(
                            ToolCallEndEvent(
                                type=EventType.TOOL_CALL_END,
                                tool_call_id=tool_call_id,
                                tool_call_result=enriched_result
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
                            result_dict = json.loads(result_content) if isinstance(result_content, str) else result_content
                            if isinstance(result_dict, dict) and result_dict.get("status") == "success":
                                
                                # Generate STATE_DELTA based on tool
                                if tool_name == "move_task_in_plan":
                                    delta = generate_move_task_delta(
                                        current_state,
                                        tool_args.get("task_id", ""),
                                        tool_args.get("target_day", ""),
                                        tool_args.get("target_index", -1),
                                        tool_args.get("start_time"),
                                    )
                                
                                elif tool_name == "add_task_to_plan":
                                    task = result_dict.get("task", {})
                                    day = result_dict.get("day", tool_args.get("day", "today"))
                                    if task:
                                        # Auto-assign start_time if missing
                                        if not task.get("start_time"):
                                            existing = current_state.columns.get(day, type('C', (), {'tasks': []})()).tasks
                                            slot = _assign_slot(existing, task.get("duration_minutes", 30))
                                            if slot:
                                                task["start_time"] = slot
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
                                        # Normalize duration and auto-assign slots for all tasks
                                        for col_key, col in plan.get("columns", {}).items():
                                            scheduled = []
                                            for task in col.get("tasks", []):
                                                # Normalize duration
                                                task["duration_minutes"] = _normalize_duration(
                                                    task.get("duration_minutes") or task.get("duration")
                                                )
                                                task.pop("duration", None)  # remove legacy field
                                                
                                                # Auto-assign start_time if missing
                                                if not task.get("start_time"):
                                                    slot = _assign_slot(
                                                        [type('T', (), {
                                                            'start_time': t.get('start_time'),
                                                            'duration_minutes': t.get('duration_minutes')
                                                        })()
                                                         for t in scheduled if t.get('start_time')],
                                                        task["duration_minutes"]
                                                    )
                                                    if slot:
                                                        task["start_time"] = slot
                                                scheduled.append(task)
                                        
                                        current_state = PlannerState(**plan)
                                        update_state(thread_id, current_state)
                                        
                                        # Emit STATE_SNAPSHOT for full replacement
                                        snapshot_event = StateSnapshotEvent(
                                            type=EventType.STATE_SNAPSHOT,
                                            snapshot=current_state.model_dump()
                                        )
                                        snapshot_encoded = encoder.encode(snapshot_event)
                                        yield snapshot_encoded
                                        # Broadcast to subscribers
                                        await broadcast_to_subscribers(thread_id, snapshot_encoded)
                                        # Skip normal delta emission for this tool
                                        del pending_tool_calls[tool_call_id]
                                        continue
                                
                                # Emit STATE_DELTA if we have patches
                                if delta:
                                    # Debug: verify we are emitting a delta (esp. for move_task_in_plan)
                                    try:
                                        logger.info(
                                            "STATE_DELTA emitting: thread_id=%s tool=%s tool_call_id=%s ops=%s",
                                            thread_id,
                                            tool_name,
                                            tool_call_id,
                                            [
                                                {
                                                    "op": op.get("op"),
                                                    "path": op.get("path"),
                                                    "from": op.get("from"),
                                                }
                                                for op in (delta[:5] if isinstance(delta, list) else [])
                                            ],
                                        )
                                    except Exception:
                                        pass
                                    # Apply to local state for subsequent operations
                                    current_state = apply_delta_to_state(current_state, delta)
                                    update_state(thread_id, current_state)
                                    
                                    delta_event = StateDeltaEvent(
                                        type=EventType.STATE_DELTA,
                                        delta=delta
                                    )
                                    delta_encoded = encoder.encode(delta_event)
                                    yield delta_encoded
                                    # Broadcast to subscribers
                                    await broadcast_to_subscribers(thread_id, delta_encoded)
                                else:
                                    # Debug: tool succeeded but no delta was generated (no-op move, fixed task, missing id, etc.)
                                    try:
                                        logger.info(
                                            "STATE_DELTA skipped (empty delta): thread_id=%s tool=%s tool_call_id=%s args=%s",
                                            thread_id,
                                            tool_name,
                                            tool_call_id,
                                            tool_args,
                                        )
                                    except Exception:
                                        pass
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

        # Close progress message on normal completion
        if progress_started and not progress_ended:
            progress_ended = True
            clear_enc = encoder.encode(
                ActivitySnapshotEvent(
                    type=EventType.ACTIVITY_SNAPSHOT,
                    messageId=progress_message_id,
                    activityType="PROGRESS",
                    content={"text": ""},
                    replace=True,
                )
            )
            yield clear_enc
            await broadcast_to_subscribers(thread_id, clear_enc)

        # 4. Save conversation history
        # Build complete message list: input messages + assistant response
        all_messages = [
            {"id": msg.id, "role": msg.role, "content": msg.content}
            for msg in input_data.messages
        ]
        # Add assistant response if we have one
        if assistant_response_text:
            all_messages.append({
                "id": message_id,
                "role": "assistant",
                "content": assistant_response_text
            })
        update_history(thread_id, all_messages)
        
        # 4b. Safeguard: close any remaining tool calls before RUN_FINISHED
        if pending_tool_calls:
            logger.warning(
                "Safeguard closing %d unclosed tool calls: %s",
                len(pending_tool_calls),
                list(pending_tool_calls.keys()),
            )
        for tc_id in list(pending_tool_calls.keys()):
            yield encoder.encode(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tc_id,
                    tool_call_result=""
                )
            )
            del pending_tool_calls[tc_id]
        
        # 5. Emit RUN_FINISHED
        run_finished_encoded = encoder.encode(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id
            )
        )
        yield run_finished_encoded
        # Broadcast to subscribers (needed for voice mode)
        await broadcast_to_subscribers(thread_id, run_finished_encoded)

    except Exception as e:
        import traceback
        error_message_id = str(uuid.uuid4())

        # Clear progress activity on error
        if progress_started and not progress_ended:
            progress_ended = True
            clear_enc = encoder.encode(
                ActivitySnapshotEvent(
                    type=EventType.ACTIVITY_SNAPSHOT,
                    messageId=progress_message_id,
                    activityType="PROGRESS",
                    content={"text": ""},
                    replace=True,
                )
            )
            yield clear_enc
            await broadcast_to_subscribers(thread_id, clear_enc)

        # AG-UI requires all text messages to be closed before RUN_FINISHED.
        if text_message_started:
            yield encoder.encode(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=message_id
                )
            )

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

        # Close any remaining tool calls before RUN_FINISHED
        try:
            remaining = list(pending_tool_calls.keys()) if pending_tool_calls else []
        except NameError:
            remaining = []
        for tc_id in remaining:
            yield encoder.encode(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tc_id,
                    tool_call_result=""
                )
            )
            del pending_tool_calls[tc_id]

        # Still emit RUN_FINISHED
        run_finished_encoded = encoder.encode(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id
            )
        )
        yield run_finished_encoded
        await broadcast_to_subscribers(thread_id, run_finished_encoded)


async def stream_agent_events_with_lock(input_data: RunAgentInput):
    """
    Pass-through to stream_agent_events. The lock was removed because
    async generator finalization doesn't guarantee __aexit__ is called when
    the HTTP client disconnects, leaving the lock permanently held.
    LangGraph handles its own concurrency internally.
    """
    async for event in stream_agent_events(input_data):
        yield event


@app.post("/agent/action")
async def apply_action(action_req: ActionRequest):
    """
    Lightweight action endpoint for UI-driven state changes (no LLM).

    Currently supports:
      - action: "move_task" with payload { task_id, target_day, target_index? }
    """
    thread_id = action_req.thread_id
    current_state = get_or_create_state(thread_id)

    delta: List[Dict[str, Any]] = []
    if action_req.action == "move_task":
        payload = action_req.payload or {}
        delta = generate_move_task_delta(
            current_state,
            payload.get("task_id", ""),
            payload.get("target_day", ""),
            payload.get("target_index", -1),
            payload.get("start_time"),
        )

    if not delta:
        # No-op (e.g., invalid task or fixed task); respond success but do not broadcast.
        try:
            logger.info(
                "ACTION no_op (empty delta): thread_id=%s action=%s payload=%s",
                thread_id,
                action_req.action,
                action_req.payload,
            )
        except Exception:
            pass
        return {"status": "no_op"}

    # Apply delta and broadcast STATE_DELTA
    new_state = apply_delta_to_state(current_state, delta)
    update_state(thread_id, new_state)

    encoder = EventEncoder()
    delta_event = StateDeltaEvent(
        type=EventType.STATE_DELTA,
        delta=delta,
    )
    delta_encoded = encoder.encode(delta_event)
    try:
        logger.info(
            "ACTION STATE_DELTA emitting: thread_id=%s action=%s ops=%s",
            thread_id,
            action_req.action,
            [
                {"op": op.get("op"), "path": op.get("path"), "from": op.get("from")}
                for op in (delta[:5] if isinstance(delta, list) else [])
            ],
        )
    except Exception:
        pass
    await broadcast_to_subscribers(thread_id, delta_encoded)

    return {"status": "success"}


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
            stream_agent_events_with_lock(input_data),
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


@app.get("/agent/history/{thread_id}")
async def get_conversation_history(thread_id: str):
    """
    Get conversation history for a thread.
    Used by voice agent to fetch previous chat history.
    """
    history = get_history(thread_id)
    return {
        "thread_id": thread_id,
        "messages": history
    }


@app.get("/agent/subscribe/{thread_id}")
async def subscribe_to_state(thread_id: str):
    """
    Subscribe to state changes for a thread.
    
    Returns a persistent SSE stream that broadcasts STATE_DELTA and STATE_SNAPSHOT events
    whenever the state changes (from any source: chat, voice, etc.).
    """
    queue = asyncio.Queue()
    
    # Register subscriber
    if thread_id not in _subscribers:
        _subscribers[thread_id] = []
    _subscribers[thread_id].append(queue)
    
    # Send initial state snapshot
    encoder = EventEncoder()
    current_state = get_or_create_state(thread_id)
    initial_snapshot = encoder.encode(
        StateSnapshotEvent(
            type=EventType.STATE_SNAPSHOT,
            snapshot=current_state.model_dump()
        )
    )
    await queue.put(initial_snapshot)
    
    async def event_stream():
        try:
            while True:
                try:
                    # Wait for events with timeout to allow checking connection status
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            # Client disconnected
            pass
        finally:
            # Unregister subscriber
            if thread_id in _subscribers and queue in _subscribers[thread_id]:
                _subscribers[thread_id].remove(queue)
                if not _subscribers[thread_id]:
                    del _subscribers[thread_id]
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "protocol": "ag-ui"}


if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", "8000"))
    
    uvicorn.run(app, host=host, port=port)
