# Gantt Time Dimension + Visual Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a time dimension to tasks and a Gantt board view (rows=days, x-axis=time) while refreshing the app's visual identity to a dark editorial aesthetic.

**Architecture:** Additive schema change — `start_time` (HH:MM string) and `duration_minutes` (int) added to the existing `Task` model. Both views (Kanban + Gantt) read from the same Zustand state. A `viewMode` toggle in the store switches rendering. The server handles duration normalization and slot assignment for tasks missing `start_time`. Scheduling rules live in a config file appended to the system prompt at startup.

**Tech Stack:** Python/FastAPI/Pydantic (backend), React/TypeScript/Zustand/dnd-kit (frontend), Tailwind CSS, Google Fonts (Fraunces, Instrument Sans, DM Mono)

---

## Context You Need

- **`project-planning-agent/schema.py`** — Pydantic models. `Task` is the model to change.
- **`project-planning-agent/tools/actions.py`** — Agent tools. `set_full_plan` builds task dicts via `process_tasks()`, `move_task_in_plan` and `add_task_to_plan` are also here.
- **`project-planning-agent/tools/calendar.py`** — Reads `data/mock_calendar.json`, returns raw dicts.
- **`project-planning-agent/server.py`** — Intercepts tool results and generates JSON Patches. Key functions: `generate_move_task_delta` (line ~155), `generate_add_task_delta` (line ~204). The `set_full_plan` interceptor is at line ~765.
- **`project-planning-agent/agent_logic.py`** — Agent definition. `SYSTEM_PROMPT` is a plain string constant; `create_planner_agent()` uses it.
- **`frontend/src/store/types.ts`** — TypeScript types, must mirror schema.py exactly.
- **`frontend/src/store/usePlannerStore.ts`** — Zustand store. `optimisticMove` lives here.
- **`frontend/src/hooks/useAgUiPlanner.ts`** — `notifyMove` sends a POST to `/agent/action` with `{task_id, target_day}`.
- **`frontend/src/components/Board.tsx`** — Renders three `<Column>` components via dnd-kit `DndContext`.
- **`frontend/src/styles/globals.css`** — Global CSS with current glass/light theme vars.

---

## Task 1: Schema — Add `start_time` and `duration_minutes` to Task

**Files:**
- Modify: `project-planning-agent/schema.py`
- Modify: `project-planning-agent/data/mock_calendar.json`
- Create: `project-planning-agent/tests/test_schema.py`

**Step 1: Write the failing test**

Create `project-planning-agent/tests/__init__.py` (empty) and `project-planning-agent/tests/test_schema.py`:

```python
import pytest
from schema import Task, TaskType, TaskStatus


def test_task_has_start_time_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert task.start_time is None  # optional, defaults to None


def test_task_has_duration_minutes_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert task.duration_minutes is None


def test_task_accepts_start_time():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED, start_time="09:00", duration_minutes=30)
    assert task.start_time == "09:00"
    assert task.duration_minutes == 30


def test_task_no_duration_string_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert not hasattr(task, "duration") or task.model_fields.get("duration") is None
```

**Step 2: Run test to verify it fails**

```bash
cd project-planning-agent
pytest tests/test_schema.py -v
```

Expected: FAIL — `Task has no field start_time` / `Task has field 'duration'`

**Step 3: Update `schema.py`**

Replace the `Task` class body (keep all other classes unchanged):

```python
class Task(BaseModel):
    """Represents a single task or calendar event."""
    model_config = ConfigDict(use_enum_values=True)
    
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None          # 'calendar', 'email', 'user'
    duration_minutes: Optional[int] = None # e.g., 60
    start_time: Optional[str] = None       # e.g., "09:00" (24h HH:MM)
```

**Step 4: Normalize mock_calendar.json**

Replace `project-planning-agent/data/mock_calendar.json` content:

```json
[
  {"id": "evt_1", "title": "Board Meeting",         "day": "today",    "start_time": "10:00", "duration_minutes": 60,  "type": "fixed"},
  {"id": "evt_2", "title": "Team Standup",           "day": "today",    "start_time": "09:00", "duration_minutes": 30,  "type": "fixed"},
  {"id": "evt_3", "title": "Dentist Appointment",    "day": "tomorrow", "start_time": "14:00", "duration_minutes": 60,  "type": "fixed"},
  {"id": "evt_4", "title": "Client Call - Acme Corp","day": "tomorrow", "start_time": "11:00", "duration_minutes": 45,  "type": "fixed"},
  {"id": "evt_5", "title": "Weekly Review",          "day": "next",     "start_time": "15:00", "duration_minutes": 60,  "type": "fixed"}
]
```

**Step 5: Run tests**

```bash
pytest tests/test_schema.py -v
```

Expected: All 4 PASS

**Step 6: Commit**

```bash
git add project-planning-agent/schema.py project-planning-agent/data/mock_calendar.json project-planning-agent/tests/
git commit -m "feat(schema): add start_time and duration_minutes to Task, normalize mock calendar data"
```

---

## Task 2: TypeScript Types Mirror

**Files:**
- Modify: `frontend/src/store/types.ts`

**Step 1: Update `types.ts`**

Replace the `Task` interface (keep all other interfaces unchanged):

```ts
export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  source?: 'calendar' | 'email' | 'user';
  duration_minutes?: number;   // was: duration?: string
  start_time?: string;          // new: "HH:MM" 24h
}
```

**Step 2: Check for TypeScript errors**

```bash
cd frontend
npx tsc --noEmit
```

Expected: 0 errors (both old fields were optional — removing `duration` just drops an unused field)

**Step 3: Commit**

```bash
git add frontend/src/store/types.ts
git commit -m "feat(types): mirror schema Task changes — duration_minutes + start_time"
```

---

## Task 3: Scheduling Rules Config + Agent Prompt Loading

**Files:**
- Create: `project-planning-agent/config/scheduling_rules.md`
- Modify: `project-planning-agent/agent_logic.py`

**Step 1: Create `project-planning-agent/config/scheduling_rules.md`**

```markdown
## Time Scheduling Rules

These rules apply whenever the agent assigns time slots to tasks.

- Working hours: 09:00–19:00 only. Never schedule outside this window.
- Fixed tasks: preserve their `start_time` from calendar data exactly. Never mutate.
- Flexible tasks: pack from 09:00, leave a 15-minute buffer after each fixed task ends.
- All `duration_minutes` values must be multiples of 30 (minimum 30). Round up if needed.
- Never schedule overlapping tasks on the same day.
- If a day is full (no free 30-min slot between 09:00–19:00), move the flexible task to the next available day.
- Tone thresholds based on total scheduled minutes per day:
  - < 240 minutes (4h): calm
  - 240–480 minutes (4–8h): neutral
  - > 480 minutes (8h+): tight
- When calling set_full_plan, always include `start_time` and `duration_minutes` for every task.
```

**Step 2: Update `agent_logic.py` to load and append the rules**

Add a loader function and update `create_planner_agent`:

```python
from pathlib import Path

def _load_scheduling_rules() -> str:
    """Load scheduling rules from config file, return empty string on failure."""
    rules_path = Path(__file__).parent / "config" / "scheduling_rules.md"
    try:
        return "\n\n" + rules_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
```

Then in `create_planner_agent`, replace the `system_prompt=SYSTEM_PROMPT` line:

```python
agent = create_agent(
    model=model,
    tools=tools,
    system_prompt=SYSTEM_PROMPT + _load_scheduling_rules(),
)
```

Also update the `set_full_plan` docstring example in `SYSTEM_PROMPT` to show `start_time` and `duration_minutes`:

```python
# In SYSTEM_PROMPT, update the set_full_plan description line:
'- `set_full_plan(today_tasks, tomorrow_tasks, next_tasks, global_tone)`: Bulk-set the entire plan. Each task MUST include `start_time` (HH:MM) and `duration_minutes` (int, multiple of 30).'
```

**Step 3: Commit**

```bash
git add project-planning-agent/config/ project-planning-agent/agent_logic.py
git commit -m "feat(agent): decouple scheduling rules to config/scheduling_rules.md, load at startup"
```

---

## Task 4: Server Utilities — `_normalize_duration` and `_assign_slot`

**Files:**
- Modify: `project-planning-agent/server.py`
- Modify: `project-planning-agent/tests/test_schema.py` (extend with server util tests)

**Step 1: Write failing tests**

Add to `project-planning-agent/tests/test_schema.py`:

```python
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from server import _normalize_duration, _assign_slot
from schema import Task, TaskType, TaskStatus


# _normalize_duration tests
def test_normalize_duration_hours():
    assert _normalize_duration("1h") == 60

def test_normalize_duration_minutes_string():
    assert _normalize_duration("30m") == 30

def test_normalize_duration_mixed():
    assert _normalize_duration("45m") == 45

def test_normalize_duration_int_passthrough():
    assert _normalize_duration(60) == 60

def test_normalize_duration_none():
    assert _normalize_duration(None) == 30  # default to 30 min


# _assign_slot tests
def _make_task(start: str, duration: int) -> Task:
    return Task(id="t", title="T", type=TaskType.FIXED, 
                start_time=start, duration_minutes=duration)

def test_assign_slot_empty_day():
    result = _assign_slot([], 60)
    assert result == "09:00"

def test_assign_slot_after_fixed_task():
    existing = [_make_task("09:00", 60)]   # ends 10:00
    result = _assign_slot(existing, 30)
    assert result == "10:15"  # 10:00 + 15 min buffer

def test_assign_slot_skips_overlap():
    existing = [
        _make_task("09:00", 60),   # ends 10:00
        _make_task("10:15", 45),   # ends 11:00
    ]
    result = _assign_slot(existing, 30)
    assert result == "11:15"  # 11:00 + 15 min buffer

def test_assign_slot_respects_working_hours():
    # Fill up to near end of day
    existing = [_make_task("09:00", 540)]  # 9h, ends 18:00
    result = _assign_slot(existing, 60)
    assert result is None  # no room before 19:00
```

**Step 2: Run to verify failures**

```bash
cd project-planning-agent
pytest tests/test_schema.py -k "normalize or assign_slot" -v
```

Expected: ImportError (functions don't exist yet)

**Step 3: Add `_normalize_duration` and `_assign_slot` to `server.py`**

Add these two functions near the top of `server.py`, after the imports section (before the `generate_*` delta functions):

```python
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


def _assign_slot(existing_tasks: list, duration_minutes: int) -> str | None:
    """
    Find the earliest free 30-min-aligned slot on a day, given existing tasks.
    
    Packs from 09:00, leaves a 15-min buffer after each existing task.
    Returns "HH:MM" string or None if no slot fits before 19:00.
    
    Args:
        existing_tasks: list of Task objects with start_time + duration_minutes
        duration_minutes: how long the new task needs (already normalized)
    """
    WORK_START = 9 * 60    # 09:00 in minutes
    WORK_END   = 19 * 60   # 19:00 in minutes
    BUFFER     = 15

    # Build list of (start, end) intervals from scheduled tasks
    intervals = []
    for t in existing_tasks:
        if t.start_time and t.duration_minutes:
            h, m = map(int, t.start_time.split(":"))
            start = h * 60 + m
            intervals.append((start, start + t.duration_minutes))
    intervals.sort()

    # Try slots from WORK_START, snapped to 30-min grid
    cursor = WORK_START
    while cursor + duration_minutes <= WORK_END:
        end = cursor + duration_minutes
        # Check for overlap with any existing interval
        overlap = any(
            not (end + BUFFER <= s or cursor >= e + BUFFER)
            for s, e in intervals
        )
        if not overlap:
            h, m = divmod(cursor, 60)
            return f"{h:02d}:{m:02d}"
        # Advance to next 30-min boundary after earliest blocking interval
        blocking_ends = [e for s, e in intervals if not (end <= s or cursor >= e + BUFFER)]
        if blocking_ends:
            next_try = max(blocking_ends) + BUFFER
            # Snap to next 30-min mark
            cursor = ((next_try + 29) // 30) * 30
        else:
            cursor += 30
    return None
```

**Step 4: Run tests**

```bash
pytest tests/test_schema.py -v
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add project-planning-agent/server.py project-planning-agent/tests/test_schema.py
git commit -m "feat(server): add _normalize_duration and _assign_slot helpers with tests"
```

---

## Task 5: Tool Updates — Pass Through Time Fields

**Files:**
- Modify: `project-planning-agent/tools/actions.py`
- Modify: `project-planning-agent/tools/calendar.py`

**Step 1: Update `actions.py` — `set_full_plan`**

In `process_tasks()` inside `set_full_plan`, add passthrough for the new fields:

```python
def process_tasks(tasks: List[Dict], day: str) -> List[Dict]:
    processed = []
    for t in tasks:
        task = {
            "id": f"task-{uuid.uuid4().hex[:8]}",
            "title": t.get("title", "Untitled"),
            "type": t.get("type", "flexible"),
            "status": "pending",
            "source": t.get("source", "user"),
            "duration_minutes": t.get("duration_minutes"),   # new
            "start_time": t.get("start_time"),               # new
        }
        # Strip None values to keep payloads clean
        task = {k: v for k, v in task.items() if v is not None or k in ("id", "title", "type", "status")}
        processed.append(task)
    return processed
```

Also update the docstring example to show the new fields:

```python
"""
...
Example:
    set_full_plan(
        today_tasks=[
            {"title": "Team Standup", "type": "fixed", "source": "calendar",
             "start_time": "09:00", "duration_minutes": 30},
            {"title": "Review PR", "type": "flexible", "source": "user",
             "start_time": "10:00", "duration_minutes": 60}
        ],
        ...
    )
"""
```

**Step 2: Update `move_task_in_plan` — add `start_time` parameter**

```python
@tool
def move_task_in_plan(
    task_id: str,
    target_day: str,
    target_index: int = -1,
    start_time: Optional[str] = None,   # new: target start time, or None to auto-assign
) -> dict:
    """
    Move a flexible task to a different day, optionally to a specific time slot.
    
    Args:
        task_id: The ID of the task to move
        target_day: 'today', 'tomorrow', or 'next'
        target_index: Position in target column (-1 = append)
        start_time: New start time as "HH:MM" (optional — server auto-assigns if None)
    """
    if target_day not in ["today", "tomorrow", "next"]:
        return {"status": "error", "message": f"Invalid target_day: {target_day}."}
    
    result = {
        "status": "success",
        "message": f"Moved task {task_id} to {target_day}",
        "task_id": task_id,
        "target_day": target_day,
        "target_index": target_index,
    }
    if start_time:
        result["start_time"] = start_time
    return result
```

**Step 3: Update `add_task_to_plan` — add time parameters**

```python
@tool
def add_task_to_plan(
    title: str,
    day: str,
    source: str = "user",
    urgency: str = "low",
    duration_minutes: int = 30,
    start_time: Optional[str] = None,
) -> dict:
    """
    Create a new task. Server auto-assigns start_time if not provided.
    
    Args:
        title: Task name
        day: 'today', 'tomorrow', or 'next'
        source: 'email' or 'user'
        urgency: 'high' or 'low'
        duration_minutes: Task duration in minutes (must be multiple of 30)
        start_time: Start time as "HH:MM" (optional — server auto-assigns)
    """
    if day not in ["today", "tomorrow", "next"]:
        return {"status": "error", "message": f"Invalid day: {day}."}
    if source not in ["email", "user"]:
        return {"status": "error", "message": f"Invalid source: {source}."}
    
    new_task = {
        "id": f"task-{uuid.uuid4().hex[:8]}",
        "title": title,
        "type": "flexible",
        "status": "pending",
        "source": source,
        "duration_minutes": duration_minutes,
    }
    if start_time:
        new_task["start_time"] = start_time
    
    return {
        "status": "success",
        "message": f"Created task '{title}' in {day}",
        "task": new_task,
        "day": day,
    }
```

**Step 4: Update `calendar.py` — pass through `start_time` and `duration_minutes`**

The current `fetch_calendar` returns raw dicts from JSON. Since the JSON now has `start_time` and `duration_minutes`, no code change is needed — the raw dict passthrough already works. Verify:

```bash
cd project-planning-agent
python -c "
from tools.calendar import fetch_calendar
events = fetch_calendar.invoke({'day_filter': 'today'})
print(events)
assert 'start_time' in events[0], 'start_time missing!'
assert 'duration_minutes' in events[0], 'duration_minutes missing!'
print('OK')
"
```

Expected: prints events with `start_time` and `duration_minutes` keys, then `OK`

**Step 5: Commit**

```bash
git add project-planning-agent/tools/actions.py project-planning-agent/tools/calendar.py
git commit -m "feat(tools): pass through start_time and duration_minutes in set_full_plan, move, add"
```

---

## Task 6: Server Interceptor — Normalize Duration and Auto-Assign Slots

**Files:**
- Modify: `project-planning-agent/server.py`

The `set_full_plan` interceptor (around line 765) builds a `PlannerState` from the agent's plan dict. It needs to:
1. Normalize duration strings → int via `_normalize_duration`
2. Auto-assign `start_time` to any flexible task missing it via `_assign_slot`
3. Pass `start_time` through in `generate_move_task_delta` when provided

**Step 1: Update `set_full_plan` interceptor**

Find the `elif tool_name == "set_full_plan":` block (around line 765). Replace the `plan = result_dict.get("plan", {})` section:

```python
elif tool_name == "set_full_plan":
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
                        [type('T', (), {'start_time': t.get('start_time'), 
                                        'duration_minutes': t.get('duration_minutes')})() 
                         for t in scheduled if t.get('start_time')],
                        task["duration_minutes"]
                    )
                    if slot:
                        task["start_time"] = slot
                scheduled.append(task)
        
        current_state = PlannerState(**plan)
        update_state(thread_id, current_state)
        snapshot_event = StateSnapshotEvent(
            type=EventType.STATE_SNAPSHOT,
            snapshot=current_state.model_dump()
        )
        snapshot_encoded = encoder.encode(snapshot_event)
        yield snapshot_encoded
        await broadcast_to_subscribers(thread_id, snapshot_encoded)
        del pending_tool_calls[tool_call_id]
        continue
```

**Step 2: Update `generate_move_task_delta` to accept `start_time`**

Add `start_time: Optional[str] = None` parameter and append a `replace` patch when provided:

```python
def generate_move_task_delta(
    current_state: PlannerState,
    task_id: str,
    target_day: str,
    target_index: int = -1,
    start_time: Optional[str] = None,      # new
) -> List[Dict[str, Any]]:
    # ... existing find-task logic unchanged ...
    
    patches = [{
        "op": "move",
        "from": from_path,
        "path": to_path
    }]
    
    # If a new start_time was provided, patch it after the move
    if start_time:
        # The task will be appended, so index is len(target_col.tasks)
        target_len = len(current_state.columns[target_day].tasks)
        patches.append({
            "op": "replace",
            "path": f"/columns/{target_day}/tasks/{target_len}/start_time",
            "value": start_time
        })
    
    return patches
```

**Step 3: Update the move_task_in_plan call in the interceptor** to pass `start_time`:

```python
if tool_name == "move_task_in_plan":
    delta = generate_move_task_delta(
        current_state,
        tool_args.get("task_id", ""),
        tool_args.get("target_day", ""),
        tool_args.get("target_index", -1),
        tool_args.get("start_time"),          # new
    )
```

**Step 4: Update `add_task_to_plan` interceptor** to auto-assign slot if missing:

```python
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
```

**Step 5: Smoke test — start the server and send a plan request**

```bash
cd project-planning-agent
uvicorn server:app --reload --port 8000
```

In a separate terminal:
```bash
curl -X POST http://localhost:8000/agent \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "test-time", "messages": [{"id": "1", "role": "user", "content": "Plan my day"}]}' \
  | grep -A2 "start_time"
```

Expected: SSE stream contains task objects with `start_time` fields populated.

**Step 6: Commit**

```bash
git add project-planning-agent/server.py
git commit -m "feat(server): normalize duration, auto-assign slots in set_full_plan and add_task interceptors"
```

---

## Task 7: Visual Identity — CSS Variables + Fonts

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/globals.css`

**Step 1: Add Google Fonts to `index.html`**

Add inside `<head>`, before the existing `<link>` tags:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Step 2: Replace CSS variables in `globals.css`**

Replace the `:root` block and any existing tone classes with:

```css
:root {
  /* Base surfaces */
  --bg-base:        #0E1117;
  --bg-surface:     #161B27;
  --bg-elevated:    #1D2535;
  --border:         #252D3D;

  /* Accent — warm amber */
  --accent:         #F0A500;
  --accent-dim:     rgba(240, 165, 0, 0.15);

  /* Task block colours */
  --fixed-bg:       #0F2E4A;
  --fixed-border:   #2A6FA8;
  --flex-bg:        #1A2535;
  --flex-border:    #3A4D66;
  --done-bg:        #0F2818;
  --done-border:    #2A6B45;
  --unscheduled-bg: repeating-linear-gradient(
    45deg, #1A2535 0px, #1A2535 8px, #1D2B3A 8px, #1D2B3A 16px
  );

  /* Text */
  --text-primary:   #E4E8F0;
  --text-secondary: #6B7A99;
  --text-muted:     #3D4A62;

  /* Fonts */
  --font-display: 'Fraunces', Georgia, serif;
  --font-body:    'Instrument Sans', system-ui, sans-serif;
  --font-mono:    'DM Mono', 'Courier New', monospace;

  /* Tone accent (overridden by tone classes) */
  --tone-accent:    #F0A500;
  --tone-bg-light:  rgba(240, 165, 0, 0.08);
}

/* Tone overrides — shift accent only, dark base stays constant */
.tone-calm    { --tone-accent: #4AADE8; --tone-bg-light: rgba(74,173,232,0.08); }
.tone-neutral { --tone-accent: #F0A500; --tone-bg-light: rgba(240,165,0,0.08); }
.tone-tight   { --tone-accent: #E85A4A; --tone-bg-light: rgba(232,90,74,0.08); }
.tone-happy   { --tone-accent: #6BCB77; --tone-bg-light: rgba(107,203,119,0.08); }
.tone-sad     { --tone-accent: #7B9ED9; --tone-bg-light: rgba(123,158,217,0.08); }
.tone-stressed{ --tone-accent: #E8A04A; --tone-bg-light: rgba(232,160,74,0.08); }

/* Base styles */
body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-body);
}

/* Scrollbar */
.custom-scrollbar::-webkit-scrollbar       { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* Glass card — updated for dark theme */
.glass-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* View transition */
.view-fade-enter { opacity: 0; transform: translateY(8px); }
.view-fade-enter-active { opacity: 1; transform: translateY(0); transition: opacity 200ms ease-out, transform 200ms ease-out; }
```

**Step 3: Run dev server and verify dark background loads**

```bash
cd frontend
npm run dev
```

Open browser. Expected: dark `#0E1117` background, no white flash.

**Step 4: Commit**

```bash
git add frontend/index.html frontend/src/styles/globals.css
git commit -m "feat(ui): dark editorial theme — CSS variables, Google Fonts (Fraunces, Instrument Sans, DM Mono)"
```

---

## Task 8: Existing Component Aesthetic Refresh

**Files:**
- Modify: `frontend/src/components/Board.tsx`
- Modify: `frontend/src/components/Column.tsx`
- Modify: `frontend/src/components/TaskCard.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`

Apply the new CSS variables and font classes. No structural changes — purely visual.

**Step 1: Update `Board.tsx` header**

```tsx
{/* Header */}
<div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
  <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 600 }}>
    Rolling 3-Day Planner
  </h1>
</div>
```

**Step 2: Update `Column.tsx`**

Replace hardcoded Tailwind colors with CSS var references:

```tsx
// Load level badge colours
const loadColors = {
  light:  { background: 'rgba(74,173,232,0.15)',  color: '#4AADE8'  },
  medium: { background: 'rgba(240,165,0,0.15)',   color: '#F0A500'  },
  heavy:  { background: 'rgba(232,90,74,0.15)',   color: '#E85A4A'  },
};

// Column container
<div
  ref={setNodeRef}
  className="flex-1 glass-card p-4 min-h-[500px] custom-scrollbar"
  style={isOver ? { borderColor: 'var(--tone-accent)', borderWidth: 2 } : {}}
>
  {/* Header */}
  <div className="mb-4 border-l-4 pl-3" style={{ borderColor: 'var(--tone-accent)' }}>
    <div className="flex items-center justify-between">
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600 }}>
        {column.label}
      </h3>
      <span className="text-xs px-2 py-1 rounded" style={loadColors[column.load_level]}>
        {column.load_level}
      </span>
    </div>
  </div>
  ...
```

**Step 3: Update `TaskCard.tsx`**

```tsx
// Fixed tasks use --fixed-bg/--fixed-border; flexible use --flex-bg/--flex-border
const cardStyle = isFixed
  ? { background: 'var(--fixed-bg)', borderColor: 'var(--fixed-border)', borderWidth: 1 }
  : task.status === 'done'
  ? { background: 'var(--done-bg)', borderColor: 'var(--done-border)', borderWidth: 1 }
  : { background: 'var(--flex-bg)', borderColor: 'var(--flex-border)', borderWidth: 1, borderStyle: 'dashed' };

// Title
<h4 style={{ fontFamily: 'var(--font-body)', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}
    className={task.status === 'done' ? 'line-through' : ''}>
  {task.title}
</h4>

// Duration display (use duration_minutes)
{task.duration_minutes && (
  <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
    {task.duration_minutes}m
    {task.start_time && ` · ${task.start_time}`}
  </p>
)}
```

**Step 4: Update `ChatPanel.tsx`**

Replace light Tailwind classes with dark theme equivalents:

```tsx
// Outer container — no change needed (inherits body bg)

// Message bubbles
// User:     background: 'var(--tone-accent)', color: '#0E1117'
// Assistant: background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)'

// Input field
className="flex-1 px-4 py-2 rounded-lg focus:outline-none focus:ring-2"
style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}

// Send button
style={{ background: 'var(--tone-accent)', color: '#0E1117' }}
```

**Step 5: Verify visually in browser**

Check: dark background, amber accents, Fraunces headers, no broken layout.

**Step 6: Commit**

```bash
git add frontend/src/components/Board.tsx frontend/src/components/Column.tsx \
        frontend/src/components/TaskCard.tsx frontend/src/components/ChatPanel.tsx
git commit -m "feat(ui): apply dark editorial theme to existing Board, Column, TaskCard, ChatPanel"
```

---

## Task 9: Zustand Store — `viewMode` and Time Helpers

**Files:**
- Modify: `frontend/src/store/usePlannerStore.ts`
- Create: `frontend/src/utils/time.ts`
- Create: `frontend/src/utils/time.test.ts`

**Step 1: Write failing time helper tests**

Create `frontend/src/utils/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { timeToMinutes, minutesToTime, snapTo30, computeTimeRange } from './time';
import type { Task } from '../store/types';

describe('timeToMinutes', () => {
  it('converts HH:MM to minutes', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('14:30')).toBe(870);
  });
});

describe('minutesToTime', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(870)).toBe('14:30');
  });
});

describe('snapTo30', () => {
  it('snaps to nearest 30-min boundary', () => {
    expect(snapTo30(545)).toBe(540); // 9:05 → 9:00
    expect(snapTo30(556)).toBe(570); // 9:16 → 9:30
  });
});

describe('computeTimeRange', () => {
  it('returns default working hours when no tasks', () => {
    const range = computeTimeRange([]);
    expect(range.start).toBe(9 * 60);
    expect(range.end).toBe(19 * 60);
  });

  it('expands to fit tasks outside default range', () => {
    const tasks: Partial<Task>[] = [
      { start_time: '07:30', duration_minutes: 60 },
      { start_time: '19:00', duration_minutes: 60 },
    ];
    const range = computeTimeRange(tasks as Task[]);
    expect(range.start).toBeLessThanOrEqual(7 * 60);  // before 7:30
    expect(range.end).toBeGreaterThanOrEqual(20 * 60); // after 20:00
  });
});
```

**Step 2: Run to verify failures**

```bash
cd frontend
npx vitest run src/utils/time.test.ts
```

Expected: Cannot find module `./time`

**Step 3: Create `frontend/src/utils/time.ts`**

```ts
import type { Task } from '../store/types';

const PX_PER_MIN = 2;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function snapTo30(minutes: number): number {
  return Math.round(minutes / 30) * 30;
}

export interface TimeRange {
  start: number;  // minutes from midnight
  end: number;
}

const DEFAULT_START = 9 * 60;   // 09:00
const DEFAULT_END   = 19 * 60;  // 19:00
const PADDING       = 30;        // 30-min padding around earliest/latest task

export function computeTimeRange(tasks: Task[]): TimeRange {
  const scheduled = tasks.filter((t) => t.start_time && t.duration_minutes);
  if (scheduled.length === 0) return { start: DEFAULT_START, end: DEFAULT_END };

  const starts = scheduled.map((t) => timeToMinutes(t.start_time!));
  const ends   = scheduled.map((t) => timeToMinutes(t.start_time!) + t.duration_minutes!);

  const earliest = Math.min(...starts) - PADDING;
  const latest   = Math.max(...ends) + PADDING;

  // Snap to hour boundaries and respect default working hours as minimum
  return {
    start: Math.min(DEFAULT_START, Math.floor(earliest / 60) * 60),
    end:   Math.max(DEFAULT_END,   Math.ceil(latest / 60) * 60),
  };
}

export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MIN;
}

export { PX_PER_MIN };
```

**Step 4: Run tests**

```bash
npx vitest run src/utils/time.test.ts
```

Expected: All PASS

**Step 5: Add `viewMode` to Zustand store**

In `usePlannerStore.ts`, add to the store interface and implementation:

```ts
// Interface addition:
viewMode: 'kanban' | 'gantt';
setViewMode: (mode: 'kanban' | 'gantt') => void;

// Implementation (in create()):
viewMode: (localStorage.getItem('viewMode') as 'kanban' | 'gantt') ?? 'kanban',

setViewMode: (mode) => {
  localStorage.setItem('viewMode', mode);
  set({ viewMode: mode });
},
```

**Step 6: Commit**

```bash
git add frontend/src/utils/ frontend/src/store/usePlannerStore.ts
git commit -m "feat(store): add viewMode toggle + time utility helpers with tests"
```

---

## Task 10: New Gantt Components

**Files:**
- Create: `frontend/src/components/TimeRuler.tsx`
- Create: `frontend/src/components/GanttBlock.tsx`
- Create: `frontend/src/components/GanttRow.tsx`
- Create: `frontend/src/components/GanttBoard.tsx`

**Step 1: Create `TimeRuler.tsx`**

```tsx
import type { TimeRange } from '../utils/time';
import { minutesToTime, minutesToPx } from '../utils/time';

interface TimeRulerProps {
  range: TimeRange;
  labelColWidth: number;
}

export default function TimeRuler({ range, labelColWidth }: TimeRulerProps) {
  const hours: number[] = [];
  const start = Math.floor(range.start / 60) * 60;
  for (let m = start; m <= range.end; m += 60) hours.push(m);

  const totalWidth = minutesToPx(range.end - range.start);

  return (
    <div className="flex shrink-0" style={{ height: 32 }}>
      {/* Spacer for label column */}
      <div style={{ width: labelColWidth, minWidth: labelColWidth }} />
      {/* Ruler */}
      <div className="relative" style={{ width: totalWidth, minWidth: totalWidth }}>
        {hours.map((m) => {
          const left = minutesToPx(m - range.start);
          return (
            <div key={m} className="absolute top-0 h-full flex flex-col justify-end"
                 style={{ left }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                             color: 'var(--text-muted)', transform: 'translateX(-50%)' }}>
                {minutesToTime(m)}
              </span>
              <div style={{ width: 1, height: 8, background: 'var(--border)', marginLeft: '50%' }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Create `GanttBlock.tsx`**

```tsx
import { useDraggable } from '@dnd-kit/core';
import type { Task } from '../store/types';
import { timeToMinutes, minutesToPx } from '../utils/time';

interface GanttBlockProps {
  task: Task;
  rangeStartMinutes: number;
  columnId: string;
}

export default function GanttBlock({ task, rangeStartMinutes, columnId }: GanttBlockProps) {
  const isFixed = task.type === 'fixed';
  const hasTime = !!task.start_time && !!task.duration_minutes;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, column: columnId, kind: 'gantt' },
    disabled: isFixed,
  });

  const left   = hasTime ? minutesToPx(timeToMinutes(task.start_time!) - rangeStartMinutes) : 0;
  const width  = hasTime ? minutesToPx(task.duration_minutes!) : 120;

  const blockStyle: React.CSSProperties = {
    position: 'absolute',
    left,
    width,
    top: 8,
    height: 40,
    borderRadius: 4,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    cursor: isFixed ? 'default' : 'grab',
    opacity: isDragging ? 0.5 : 1,
    userSelect: 'none',
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
    ...(!hasTime
      ? { background: 'var(--unscheduled-bg)' as string, border: '1px dashed var(--flex-border)' }
      : isFixed
      ? { background: 'var(--fixed-bg)', border: '1px solid var(--fixed-border)' }
      : { background: 'var(--flex-bg)', border: '1px dashed var(--flex-border)' }
    ),
  };

  return (
    <div ref={setNodeRef} style={blockStyle} {...(!isFixed ? { ...listeners, ...attributes } : {})}>
      {isFixed && <span style={{ fontSize: '0.65rem', marginRight: 4, color: 'var(--fixed-border)' }}>🔒</span>}
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem',
                     color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.title}
      </span>
    </div>
  );
}
```

**Step 3: Create `GanttRow.tsx`**

```tsx
import { useDroppable } from '@dnd-kit/core';
import type { Column } from '../store/types';
import type { TimeRange } from '../utils/time';
import { minutesToPx } from '../utils/time';
import GanttBlock from './GanttBlock';

interface GanttRowProps {
  column: Column;
  range: TimeRange;
  labelColWidth: number;
  rowHeight: number;
}

const LOAD_COLORS = {
  light:  '#4AADE8',
  medium: '#F0A500',
  heavy:  '#E85A4A',
};

export default function GanttRow({ column, range, labelColWidth, rowHeight }: GanttRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const totalWidth = minutesToPx(range.end - range.start);

  return (
    <div className="flex shrink-0" style={{ height: rowHeight }}>
      {/* Day label */}
      <div style={{ width: labelColWidth, minWidth: labelColWidth, padding: '0 12px',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    borderRight: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600,
                       color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          {column.label}
        </span>
        <span style={{ fontSize: '0.65rem', color: LOAD_COLORS[column.load_level],
                       fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {column.load_level}
        </span>
      </div>

      {/* Timeline area */}
      <div
        ref={setNodeRef}
        className="relative"
        style={{
          width: totalWidth,
          minWidth: totalWidth,
          background: isOver ? 'var(--accent-dim)' : 'transparent',
          borderBottom: '1px solid var(--border)',
          transition: 'background 150ms',
        }}
      >
        {/* 30-min grid lines */}
        {Array.from({ length: Math.floor((range.end - range.start) / 30) }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute', left: minutesToPx(i * 30), top: 0,
            width: 1, height: '100%',
            background: i % 2 === 0 ? 'var(--border)' : 'transparent',
          }} />
        ))}

        {/* Task blocks */}
        {column.tasks.map((task) => (
          <GanttBlock key={task.id} task={task} rangeStartMinutes={range.start} columnId={column.id} />
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Create `GanttBoard.tsx`**

```tsx
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core';
import { useEffect, useRef, useState } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import { computeTimeRange, snapTo30, minutesToTime, minutesToPx, PX_PER_MIN } from '../utils/time';
import type { Task } from '../store/types';
import TimeRuler from './TimeRuler';
import GanttRow from './GanttRow';

const LABEL_COL_WIDTH = 96;
const ROW_HEIGHT = 64;
const NOW_LINE_INTERVAL_MS = 60_000; // update every minute

export default function GanttBoard() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Update now-line every minute
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, NOW_LINE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Compute dynamic time range across all days
  const allTasks = Object.values(plan.columns).flatMap((c) => c.tasks);
  const range = computeTimeRange(allTasks);
  const totalWidth = minutesToPx(range.end - range.start);

  const handleDragStart = ({ active }: DragStartEvent) => {
    const task = active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  };

  const handleDragEnd = ({ active, over, delta }: DragEndEvent) => {
    setActiveTask(null);
    if (!over) return;

    const taskId = active.id as string;
    const fromCol = active.data.current?.column as string;
    const toCol = over.id as string;

    // Compute new start_time from horizontal delta
    const deltaMinutes = Math.round(delta.x / PX_PER_MIN);
    const originalTask = plan.columns[fromCol as keyof typeof plan.columns]?.tasks
      .find((t) => t.id === taskId);
    if (!originalTask || originalTask.type === 'fixed') return;

    const { timeToMinutes } = await import('../utils/time'); // already imported above
    const oldStart = originalTask.start_time
      ? timeToMinutes(originalTask.start_time)
      : range.start;
    const rawNew = oldStart + deltaMinutes;
    const newStartMinutes = snapTo30(rawNew);
    const newStartTime = minutesToTime(newStartMinutes);

    optimisticMove(taskId, fromCol, toCol);
    notifyMove(taskId, fromCol, toCol, newStartTime);
  };

  const nowLeft = LABEL_COL_WIDTH + minutesToPx(nowMinutes - range.start);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
        <div style={{ minWidth: LABEL_COL_WIDTH + totalWidth }}>
          {/* Time ruler */}
          <TimeRuler range={range} labelColWidth={LABEL_COL_WIDTH} />

          <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="relative">
              {/* Now line */}
              {nowMinutes >= range.start && nowMinutes <= range.end && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{
                    left: nowLeft,
                    width: 2,
                    background: 'var(--accent)',
                    animation: 'nowPulse 3s ease-in-out infinite',
                  }}
                />
              )}

              {Object.values(plan.columns).map((col) => (
                <GanttRow
                  key={col.id}
                  column={col}
                  range={range}
                  labelColWidth={LABEL_COL_WIDTH}
                  rowHeight={ROW_HEIGHT}
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask && (
                <div style={{ background: 'var(--flex-bg)', border: '1px dashed var(--accent)',
                              borderRadius: 4, padding: '4px 8px', opacity: 0.9 }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                    {activeTask.title}
                  </span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
```

Add the `nowPulse` keyframe to `globals.css`:

```css
@keyframes nowPulse {
  0%, 100% { opacity: 0.6; }
  50%       { opacity: 1.0; }
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/TimeRuler.tsx frontend/src/components/GanttBlock.tsx \
        frontend/src/components/GanttRow.tsx frontend/src/components/GanttBoard.tsx \
        frontend/src/styles/globals.css
git commit -m "feat(gantt): add TimeRuler, GanttBlock, GanttRow, GanttBoard components"
```

---

## Task 11: Wire Toggle in Board + Update `notifyMove`

**Files:**
- Modify: `frontend/src/components/Board.tsx`
- Modify: `frontend/src/hooks/useAgUiPlanner.ts`

**Step 1: Update `notifyMove` in `useAgUiPlanner.ts`**

Add `start_time` parameter to the function signature and payload:

```ts
const notifyMove = useCallback(async (
  taskId: string,
  fromCol: string,
  toCol: string,
  startTime?: string,    // new
) => {
  try {
    await fetch(`${BACKEND_URL}/agent/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: threadId,
        action: 'move_task',
        payload: {
          task_id: taskId,
          target_day: toCol,
          ...(startTime ? { start_time: startTime } : {}),
        },
      }),
    });
  } catch (err) {
    console.error('Failed to apply move_task action:', err);
  }
}, [threadId]);
```

Also update the return type:
```ts
notifyMove: (taskId: string, fromCol: string, toCol: string, startTime?: string) => Promise<void>,
```

**Step 2: Update `server.py` `/agent/action` endpoint**

Find the `/agent/action` endpoint handler (search for `"move_task"` in server.py). Pass `start_time` through to `generate_move_task_delta`:

```python
# In the move_task action handler:
delta = generate_move_task_delta(
    current_state,
    payload.get("task_id", ""),
    payload.get("target_day", ""),
    payload.get("target_index", -1),
    payload.get("start_time"),          # new
)
```

**Step 3: Update `Board.tsx` — add toggle + render switcher**

Replace the current `Board.tsx` content:

```tsx
import { usePlannerStore } from '../store/usePlannerStore';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import Column from './Column';
import TaskCard from './TaskCard';
import GanttBoard from './GanttBoard';
import type { Task } from '../store/types';

export default function Board() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();
  const viewMode = usePlannerStore((s) => s.viewMode);
  const setViewMode = usePlannerStore((s) => s.setViewMode);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const fromCol = active.data.current?.column as string;
    const toCol = over.id as string;
    if (fromCol === toCol) return;
    const task = plan.columns[fromCol as keyof typeof plan.columns]?.tasks.find(t => t.id === taskId);
    if (!task || task.type === 'fixed') return;
    optimisticMove(taskId, fromCol, toCol);
    notifyMove(taskId, fromCol, toCol);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 600 }}>
          Rolling 3-Day Planner
        </h1>
        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['kanban', 'gantt'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 16px',
                fontFamily: 'var(--font-body)',
                fontSize: '0.8rem',
                fontWeight: 500,
                cursor: 'pointer',
                background: viewMode === mode ? 'var(--tone-accent)' : 'var(--bg-elevated)',
                color: viewMode === mode ? '#0E1117' : 'var(--text-secondary)',
                border: 'none',
                transition: 'all 150ms',
              }}
            >
              {mode === 'kanban' ? 'Kanban' : 'Timeline'}
            </button>
          ))}
        </div>
      </div>

      {/* Board content */}
      <div className="flex-1 p-4 overflow-hidden">
        {viewMode === 'gantt' ? (
          <GanttBoard />
        ) : (
          <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-full">
              <Column column={plan.columns.today} />
              <Column column={plan.columns.tomorrow} />
              <Column column={plan.columns.next} />
            </div>
            <DragOverlay>
              {activeTask ? (
                <div className="glass-card p-3" style={{ border: '2px solid var(--tone-accent)', opacity: 0.9 }}>
                  <h4 style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {activeTask.title}
                  </h4>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Fix the dynamic import in `GanttBoard.tsx`**

The `await import(...)` inside `handleDragEnd` is incorrect — `timeToMinutes` is already imported at the top. Remove the dynamic import line in `GanttBoard.tsx`; the function is already in scope.

**Step 5: Run dev server and test full flow**

```bash
cd frontend && npm run dev
```

Manual tests:
1. Toggle between Kanban and Timeline — both views render correctly
2. In Timeline view: task blocks appear at correct time positions
3. Drag a flexible block — it snaps to 30-min grid
4. Fixed blocks cannot be dragged

**Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors

**Step 7: Commit**

```bash
git add frontend/src/components/Board.tsx frontend/src/hooks/useAgUiPlanner.ts \
        project-planning-agent/server.py
git commit -m "feat(board): add Kanban/Timeline toggle, wire notifyMove with start_time"
```

---

## Task 12: Final Integration Smoke Test + Cleanup

**Step 1: Start both servers**

Terminal 1:
```bash
cd project-planning-agent && uvicorn server:app --reload --port 8000
```

Terminal 2:
```bash
cd frontend && npm run dev
```

**Step 2: End-to-end test sequence**

1. Open `http://localhost:5173`
2. Type "Plan my day" in chat
3. **Expected**: Kanban view populates with tasks; fixed tasks show time badges (e.g., "09:00 · 30m")
4. Switch to Timeline view
5. **Expected**: Tasks rendered as blocks on time axis; Board Meeting at 10:00, Standup at 09:00
6. **Expected**: Now-line (amber vertical) visible at current time
7. Drag a flexible block to a new time slot
8. **Expected**: Block snaps to 30-min grid; agent is notified; no conflict = stays; conflict = reverts
9. Type "Move the report to tomorrow" in chat
10. **Expected**: Block disappears from today row, appears in tomorrow row

**Step 3: Run all tests**

```bash
# Backend
cd project-planning-agent
pytest tests/ -v

# Frontend
cd frontend
npx vitest run
npx tsc --noEmit
```

Expected: All green

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Gantt time dimension + dark editorial visual refresh — complete"
```

---

## Summary of All Files Changed

| File | Type |
|---|---|
| `project-planning-agent/schema.py` | Modified |
| `project-planning-agent/data/mock_calendar.json` | Modified |
| `project-planning-agent/agent_logic.py` | Modified |
| `project-planning-agent/config/scheduling_rules.md` | Created |
| `project-planning-agent/server.py` | Modified |
| `project-planning-agent/tools/actions.py` | Modified |
| `project-planning-agent/tools/calendar.py` | Verified (no change) |
| `project-planning-agent/tests/__init__.py` | Created |
| `project-planning-agent/tests/test_schema.py` | Created |
| `frontend/src/store/types.ts` | Modified |
| `frontend/src/store/usePlannerStore.ts` | Modified |
| `frontend/src/utils/time.ts` | Created |
| `frontend/src/utils/time.test.ts` | Created |
| `frontend/src/hooks/useAgUiPlanner.ts` | Modified |
| `frontend/src/components/Board.tsx` | Modified |
| `frontend/src/components/Column.tsx` | Modified |
| `frontend/src/components/TaskCard.tsx` | Modified |
| `frontend/src/components/ChatPanel.tsx` | Modified |
| `frontend/src/components/TimeRuler.tsx` | Created |
| `frontend/src/components/GanttBlock.tsx` | Created |
| `frontend/src/components/GanttRow.tsx` | Created |
| `frontend/src/components/GanttBoard.tsx` | Created |
| `frontend/src/styles/globals.css` | Modified |
| `frontend/index.html` | Modified |
