# Rolling 3-Day Planner Agent Specification

> **Protocol Compliance:** AG-UI Protocol + LangChain v1 `create_agent`

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FastAPI Server                           │
│                       (server.py)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │            AG-UI Protocol Translation Layer              │   │
│  │   - Receives RunAgentInput                               │   │
│  │   - Streams AG-UI Events via EventEncoder                │   │
│  │   - Maintains PlannerState                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           LangChain v1 Agent (agent_logic.py)           │   │
│  │   - create_agent() with tools                            │   │
│  │   - agent.stream() → Content Blocks                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌────────────────┐  ┌────────────────────────────────────┐   │
│  │    Sensors     │  │            Actuators               │   │
│  │  (read-only)   │  │    (state-modifying signals)       │   │
│  │ fetch_calendar │  │  move_task_in_plan                 │   │
│  │ fetch_emails   │  │  add_task_to_plan                  │   │
│  │                │  │  set_visual_tone                   │   │
│  │                │  │  mark_task_status                  │   │
│  └────────────────┘  └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Agent Role & Behavior

**Role:** An executive assistant with read/write access to a rolling 3-day schedule.

**Primary Job:** Maintain integrity of `PlannerState` while reacting to:
- User Chat (e.g., "Rebalance my day")
- UI Interactions (e.g., Drag & Drop validation)

**Perception-Reasoning-Action Loop:**
1. **Perceive:** Query Sensors (Calendar/Email) + Current State
2. **Reason:** Compare User Intent vs. Current Load
3. **Act:** Call Actuator tools to signal state changes
4. **Verify:** Server-side validation before STATE_DELTA emission

**Guardrails:**
- Agent NEVER outputs JSON state directly
- Agent MUST use tools to request state mutations
- Server validates and generates STATE_DELTA
- Fixed tasks cannot be moved

---

## 3. AG-UI Protocol Events

### Required SDK
```bash
pip install ag-ui-protocol
```

### Event Types Used

| Event | When Emitted | Purpose |
|-------|--------------|---------|
| `RUN_STARTED` | Request received | Indicates agent processing started |
| `STATE_SNAPSHOT` | On connection/refresh | Full state payload |
| `TEXT_MESSAGE_CONTENT` | Agent streams text | Chat message deltas |
| `TOOL_CALL_START` | Tool invocation begins | Shows "Checking calendar..." |
| `TOOL_CALL_END` | Tool returns result | Shows tool output |
| `STATE_DELTA` | State mutation approved | JSON Patch (RFC 6902) |
| `RUN_FINISHED` | Processing complete | Indicates agent done |

### Event Imports (Python)
```python
from ag_ui.core import (
    RunAgentInput,
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    StateSnapshotEvent,
    StateDeltaEvent,
    TextMessageContentEvent,
    ToolCallStartEvent,
    ToolCallEndEvent,
)
from ag_ui.encoder import EventEncoder
```

### Typical Event Stream

```
User: "Balance my day"
     │
     ▼
[RUN_STARTED]
     │
     ▼
[STATE_SNAPSHOT] ← Full PlannerState
     │
     ▼
[TOOL_CALL_START] ← fetch_calendar("today")
[TOOL_CALL_END]   ← Returns calendar data
     │
     ▼
[TEXT_MESSAGE_CONTENT] ← "I see you have 3 meetings..."
     │
     ▼
[TOOL_CALL_START] ← move_task_in_plan(task_id="task-1", target_day="tomorrow")
[TOOL_CALL_END]   ← {"status": "success", ...}
     │
     ▼
[STATE_DELTA]     ← [{"op": "move", "from": "/columns/today/tasks/0", "path": "/columns/tomorrow/tasks/-"}]
     │
     ▼
[TEXT_MESSAGE_CONTENT] ← "...so I moved the report to tomorrow."
     │
     ▼
[RUN_FINISHED]
```

---

## 4. LangChain v1 Agent Definition

### Required Package
```bash
pip install langchain langchain-openai
```

### Agent Creation Pattern
```python
from langchain.agents import create_agent
from langchain.tools import tool

# Create agent with tools
agent = create_agent(
    model="gpt-4o",  # or "anthropic:claude-sonnet-4-5-20250929"
    tools=[fetch_calendar, fetch_emails, move_task_in_plan, ...],
    system_prompt="You are a Rolling 3-Day Planner..."
)
```

### Streaming Pattern
```python
# agent.stream() yields Content Blocks
async for block in agent.stream({"messages": langchain_messages}):
    # block can be: text content, tool_call, tool_result
    # Map to AG-UI events accordingly
```

### Content Block Types
LangChain v1 `agent.stream()` yields blocks with these attributes:
- **Text:** `block.content` (string)
- **Tool Call:** `block.tool_calls` (list of tool call objects)
- **Tool Result:** `block.content` + `block.tool_call_id`

---

## 5. Tool Specifications

### A. Sensors (Read-Only)

#### `fetch_calendar`
```python
from langchain.tools import tool

@tool
def fetch_calendar(day_filter: str) -> list:
    """
    Fetch fixed calendar events for a specific day.
    
    Args:
        day_filter: 'today', 'tomorrow', or 'next'
    
    Returns:
        List of calendar events [{id, title, time, type: 'fixed'}]
    """
    # Read from mock_calendar.json
    # Filter by day_filter
    return events
```

#### `fetch_emails`
```python
@tool
def fetch_emails(urgency: str = "any") -> list:
    """
    Fetch unread emails that may need action.
    
    Args:
        urgency: 'high' or 'any' (default: 'any')
    
    Returns:
        List of email items [{id, subject, sender, urgency}]
    """
    # Read from mock_email.json
    # Filter by urgency if specified
    return emails
```

### B. Actuators (State Modifiers)

**Critical Pattern:** Actuators do NOT modify state directly. They return a "signal" that the server interprets to generate STATE_DELTA.

#### `move_task_in_plan`
```python
@tool
def move_task_in_plan(
    task_id: str,
    target_day: str,
    target_index: int = -1
) -> dict:
    """
    Move a task to a different day.
    
    Args:
        task_id: The ID of the task to move
        target_day: 'today', 'tomorrow', or 'next'
        target_index: Position in target column (-1 = append)
    
    Returns:
        {status: 'success'|'error', message: str, task_id, target_day}
    
    Server generates: STATE_DELTA op: "move"
    """
    # VALIDATION
    if target_day not in ["today", "tomorrow", "next"]:
        return {"status": "error", "message": f"Invalid target_day: {target_day}"}
    
    # Signal success - server generates STATE_DELTA
    return {
        "status": "success",
        "message": f"Moved task {task_id} to {target_day}",
        "task_id": task_id,
        "target_day": target_day,
        "target_index": target_index
    }
```

#### `add_task_to_plan`
```python
@tool
def add_task_to_plan(
    title: str,
    day: str,
    source: str = "user",
    urgency: str = "low"
) -> dict:
    """
    Create a new task from email or user request.
    
    Args:
        title: Task name
        day: 'today', 'tomorrow', or 'next'
        source: 'email' or 'user'
        urgency: 'high' or 'low'
    
    Returns:
        {status, message, task: Task object with generated ID}
    
    Server generates: STATE_DELTA op: "add"
    """
    import uuid
    
    if day not in ["today", "tomorrow", "next"]:
        return {"status": "error", "message": f"Invalid day: {day}"}
    
    new_task = {
        "id": f"task-{uuid.uuid4().hex[:8]}",
        "title": title,
        "type": "flexible",
        "status": "pending",
        "source": source
    }
    
    return {
        "status": "success",
        "message": f"Created task '{title}' in {day}",
        "task": new_task,
        "day": day
    }
```

#### `set_visual_tone`
```python
@tool
def set_visual_tone(tone: str) -> dict:
    """
    Change the UI visual tone based on workload.
    
    Args:
        tone: 'calm', 'neutral', or 'tight'
    
    Returns:
        {status, message, tone}
    
    Server generates: STATE_DELTA op: "replace", path: "/global_tone"
    """
    if tone not in ["calm", "neutral", "tight"]:
        return {"status": "error", "message": f"Invalid tone: {tone}"}
    
    return {
        "status": "success",
        "message": f"Set visual tone to {tone}",
        "tone": tone
    }
```

#### `mark_task_status`
```python
@tool
def mark_task_status(task_id: str, status: str) -> dict:
    """
    Mark a task as done or skipped.
    
    Args:
        task_id: The ID of the task
        status: 'done' or 'skipped'
    
    Returns:
        {status, message, task_id, new_status}
    
    Server generates: STATE_DELTA op: "replace", path: "/columns/.../tasks/.../status"
    """
    if status not in ["done", "skipped"]:
        return {"status": "error", "message": f"Invalid status: {status}"}
    
    return {
        "status": "success",
        "message": f"Marked task {task_id} as {status}",
        "task_id": task_id,
        "new_status": status
    }
```

---

## 6. Server Implementation Pattern

### FastAPI Endpoint
```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

@app.post("/agent")
async def run_agent(request: Request):
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
```

### Translation Layer Logic

```python
async def stream_agent_events(input_data: RunAgentInput):
    encoder = EventEncoder()
    thread_id = input_data.thread_id
    run_id = input_data.run_id
    
    # Get current state
    current_state = get_or_create_state(thread_id)
    
    # 1. Emit RUN_STARTED
    yield encoder.encode(RunStartedEvent(...))
    
    # 2. Emit STATE_SNAPSHOT
    yield encoder.encode(StateSnapshotEvent(snapshot=current_state.model_dump()))
    
    # 3. Create and stream from agent
    agent = create_planner_agent()
    
    async for block in agent.stream({"messages": messages}):
        # Map Content Blocks to AG-UI Events
        
        if has_text(block):
            yield encoder.encode(TextMessageContentEvent(delta=block.content))
        
        if has_tool_call(block):
            yield encoder.encode(ToolCallStartEvent(...))
        
        if has_tool_result(block):
            yield encoder.encode(ToolCallEndEvent(...))
            
            # STATE INTERCEPTOR: Convert tool result to STATE_DELTA
            delta = generate_state_delta(block.tool_name, block.args)
            if delta:
                yield encoder.encode(StateDeltaEvent(delta=delta))
    
    # 4. Emit RUN_FINISHED
    yield encoder.encode(RunFinishedEvent(...))
```

### State Interceptor (STATE_DELTA Generation)

The server intercepts actuator tool results and generates JSON Patches:

| Tool Call | STATE_DELTA Operation |
|-----------|----------------------|
| `move_task_in_plan(task_id, target_day)` | `{"op": "move", "from": "/columns/{source}/tasks/{idx}", "path": "/columns/{target}/tasks/-"}` |
| `add_task_to_plan(title, day)` | `{"op": "add", "path": "/columns/{day}/tasks/-", "value": {task}}` |
| `set_visual_tone(tone)` | `{"op": "replace", "path": "/global_tone", "value": "{tone}"}` |
| `mark_task_status(task_id, status)` | `{"op": "replace", "path": "/columns/{col}/tasks/{idx}/status", "value": "{status}"}` |

---

## 7. Shared State Schema

### Python (Pydantic)
```python
from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel

class VisualTone(str, Enum):
    CALM = "calm"
    NEUTRAL = "neutral"
    TIGHT = "tight"

class LoadLevel(str, Enum):
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"

class TaskType(str, Enum):
    FIXED = "fixed"
    FLEXIBLE = "flexible"

class TaskStatus(str, Enum):
    PENDING = "pending"
    DONE = "done"
    SKIPPED = "skipped"

class Task(BaseModel):
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None

class Column(BaseModel):
    id: str
    label: str
    load_level: LoadLevel
    tasks: List[Task] = []

class PlannerState(BaseModel):
    global_tone: VisualTone
    columns: Dict[str, Column]
```

---

## 8. Dependencies (requirements.txt)

```
fastapi>=0.104.1
uvicorn[standard]>=0.24.0
langchain>=1.0.0
langchain-openai>=0.3.0
pydantic>=2.5.0
python-dotenv>=1.0.0
ag-ui-protocol>=0.1.0
```

---

## 9. Implementation Checklist

### Phase 1: Core Setup
- [x] Create `schema.py` with Pydantic models
- [x] Create mock data files (`mock_calendar.json`, `mock_email.json`)
- [x] Implement LangChain v1 agent with `create_agent`
- [x] Implement FastAPI server with AG-UI SDK

### Phase 2: Complete Tools
- [x] `fetch_calendar` sensor
- [x] `fetch_emails` sensor  
- [x] `move_task_in_plan` actuator
- [ ] `add_task_to_plan` actuator
- [ ] `set_visual_tone` actuator
- [ ] `mark_task_status` actuator

### Phase 3: State Interceptors
- [x] Move task → STATE_DELTA
- [ ] Add task → STATE_DELTA
- [ ] Set tone → STATE_DELTA
- [ ] Mark status → STATE_DELTA

### Phase 4: Validation
- [ ] Test with AG-UI Dojo
- [ ] Verify STATE_SNAPSHOT on connect
- [ ] Verify STATE_DELTA on tool calls
- [ ] Verify TEXT_MESSAGE_CONTENT streaming
