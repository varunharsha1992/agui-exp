# Design: Gantt Time Dimension + Visual Refresh

**Date:** 2026-02-10  
**Status:** Approved  
**Scope:** Backend schema, agent tools, frontend Gantt view, full app aesthetic refresh

---

## Problem Statement

The current Rolling 3-Day Planner has no time dimension. Calendar events carry `start` and `duration` in the mock data but these fields are silently dropped when the agent builds the plan. All tasks — fixed calendar events and flexible work tasks — are displayed identically in a stacked kanban with no indication of *when* things happen. The result is a plan that is spatially organized (by day) but temporally blind.

---

## Goals

1. Add time dimension to tasks (`start_time`, `duration_minutes`)
2. Build a Gantt-style board view: rows = days, x-axis = time
3. Toggle between existing Kanban view and new Gantt view
4. Agent assigns time slots to flexible tasks using configurable placement rules
5. Refresh the full app visual identity to be consistent and distinctive

## Non-Goals

- Real calendar integration (still mock data)
- Multi-week or month views
- ISO timestamps / timezone handling (HH:MM strings are sufficient)
- User-configurable working hours (fixed 09:00–19:00 default)

---

## Approach

Additive schema change (Approach 1): add `start_time` and `duration_minutes` as optional fields on the existing `Task` model. No structural restructuring of `Column` or `PlannerState`. Both views read from the same state.

---

## Section 1: Schema & Contract

### `Task` model (`schema.py` + `types.ts`)

**Before:**
```python
class Task(BaseModel):
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None
    duration: Optional[str] = None  # e.g., "30m"
```

**After:**
```python
class Task(BaseModel):
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None
    duration_minutes: Optional[int] = None   # e.g., 60 (was: "1h")
    start_time: Optional[str] = None          # e.g., "09:00" (24h HH:MM)
```

**TypeScript mirror (`types.ts`):**
```ts
export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  source?: 'calendar' | 'email' | 'user';
  duration_minutes?: number;
  start_time?: string;  // "HH:MM" 24h
}
```

### Mock calendar data (`mock_calendar.json`)

Normalize existing keys:
- `"start"` → `"start_time"`
- `"duration": "1h"` → `"duration_minutes": 60`

### Backward compatibility

The Kanban view never reads `start_time` or `duration_minutes` for layout — both fields are safely ignored. Tasks missing `start_time` in the Gantt view render with an "unscheduled" visual indicator at the left edge.

---

## Section 2: Agent Tool Changes

### `set_full_plan` tool

Each task dict in `today_tasks`, `tomorrow_tasks`, `next_tasks` now accepts:

```python
{
  "id": "...",
  "title": "...",
  "type": "fixed|flexible",
  "start_time": "09:00",       # required for fixed; agent-assigned for flexible
  "duration_minutes": 60,       # always required
  "source": "calendar|email|user"
}
```

### `add_task_to_plan` tool

Add `start_time: Optional[str]` and `duration_minutes: int` parameters.

### `move_task_in_plan` tool

Add `start_time: Optional[str]` parameter — enables Gantt drag to update both day and time in one operation. If `None`, server re-assigns slot automatically.

### `fetch_calendar` tool

Pass through `start_time` and `duration_minutes` from mock data into returned Task objects so the agent can use exact times when calling `set_full_plan`.

### Scheduling rules (decoupled config)

Rules live in `project-planning-agent/config/scheduling_rules.md` and are loaded + appended to the agent system prompt at startup. Not hardcoded in `agent_logic.py`. Example rules:

```
- Working hours: 09:00–19:00 only
- Fixed tasks: use calendar start_time exactly, never mutate
- Flexible tasks: pack from 09:00, leave 15-min buffer after each fixed task
- All durations must be multiples of 30 minutes (minimum 30)
- Never schedule overlapping tasks on the same day
- If day is full, move flexible task to next available day
- Tone thresholds: <240 min/day = calm, 240–480 = neutral, >480 = tight
```

---

## Section 3: Server-Side Slot Assignment (`server.py`)

### Duration normalization

The `set_full_plan` interceptor normalizes duration strings to integers before building `PlannerState`:

```
"1h"  → 60
"30m" → 30
"45m" → 45
int   → as-is
```

### `_assign_slot` helper

Pure function in `server.py`. Called for any flexible task without a `start_time`:

```python
def _assign_slot(existing_tasks: list[Task], new_task: Task) -> str:
    """
    Pack from 09:00. Skip over existing scheduled tasks + 15-min buffer.
    Returns "HH:MM" string.
    """
```

The agent focuses on day assignment and rough order; the server guarantees non-overlapping placement.

---

## Section 4: Frontend Architecture

### View toggle

```ts
// Zustand store
viewMode: 'kanban' | 'gantt'   // persisted to localStorage
setViewMode: (mode) => void
```

Toggle button in `Board.tsx` header. Both views read from the same `plan.columns` state.

`Board.tsx` becomes a thin switcher:
```tsx
{viewMode === 'kanban' ? <KanbanBoard /> : <GanttBoard />}
```

Existing `Column.tsx` and `TaskCard.tsx` stay unchanged inside `KanbanBoard`.

### Gantt layout

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  09:00   10:00   11:00   12:00   13:00  ...      │
│  Today   │  ░[Standup]░░[Board Mtg──────]░░[Report──]░░    │
│ Tomorrow │  ░░░░░[Client Call───]░░░░░░░[Dentist──]░░░░     │
│   Next   │  ░░░░░░░░░░░░░░░░░░░[Weekly Review──]░░░░░░      │
└──────────┴──────────────────────────────────────────────────┘
```

- **Left label column**: 96px fixed — day name + load level badge
- **Timeline area**: horizontally scrollable; dynamic range = (earliest `start_time` − 30min) to (latest end time + 30min) across all days
- **Pixel scale**: 2px per minute (1 hour = 120px, 30 min = 60px)
- **Time ruler**: hour labels + 30-min tick marks at top
- **Now-line**: vertical amber line at current time, slow pulse animation

### Task blocks

```
left  = (start_minutes - range_start_minutes) * 2
width = duration_minutes * 2
```

- **Fixed tasks**: solid `--fixed-bg` fill, `--fixed-border` border, lock icon, drag disabled
- **Flexible tasks**: `--flex-bg` fill, dashed `--flex-border`, draggable, snaps to 30-min grid
- **Done tasks**: `--done-bg` fill, strikethrough title
- **Unscheduled tasks** (no `start_time`): pinned to left edge, hatched background, tooltip "unscheduled"

### New components

| Component | Role |
|---|---|
| `GanttBoard.tsx` | Outer wrapper; computes dynamic time range; renders `TimeRuler` + `GanttRow` per day |
| `GanttRow.tsx` | Single day row; positions `GanttBlock` elements on the time axis |
| `GanttBlock.tsx` | Individual task block; handles drag with 30-min snap |
| `TimeRuler.tsx` | Hour/30-min tick mark header |

### Gantt drag → patch flow

```
dragEnd fires
  └─► compute new_start_time from drop x (snapped to nearest 30-min)
  └─► compute new_day from drop row
  └─► optimisticMove: apply local patches immediately
  └─► notifyMove(taskId, fromDay, toDay, new_start_time)
        → POST /agent: "User moved {task} to {day} at {time}"
        → agent calls move_task_in_plan(start_time=new_start_time)
        → server emits STATE_DELTA confirming or adjusting
```

If the agent detects a conflict, `STATE_DELTA` reverts the optimistic update — same pattern as current drag-drop.

---

## Section 5: Visual Identity

### Design direction

**Dark editorial precision.** Dense, confident, instrument-like. The UI should feel like a tool built for someone who takes their time seriously — not a productivity toy.

### Color system

```css
--bg-base:        #0E1117;   /* near-black with slight blue cast */
--bg-surface:     #161B27;   /* cards, panels */
--bg-elevated:    #1D2535;   /* hover, dropdowns */
--border:         #252D3D;   /* dividers */

--accent:         #F0A500;   /* warm amber — time ruler, now-line, active */
--accent-dim:     #7A5500;   /* muted amber backgrounds */

--fixed-bg:       #0F2E4A;   /* fixed task blocks */
--fixed-border:   #2A6FA8;
--flex-bg:        #1A2535;   /* flexible task blocks */
--flex-border:    #3A4D66;   /* dashed */
--done-bg:        #0F2818;
--done-border:    #2A6B45;

--text-primary:   #E4E8F0;
--text-secondary: #6B7A99;
--text-muted:     #3D4A62;
```

Tone classes shift only `--accent` and `--bg-surface` tint — dark base stays constant across all tones.

### Typography

| Role | Font | Notes |
|---|---|---|
| Day labels, headings | `Fraunces` (variable serif) | Optical, press-like — anchor of the identity |
| UI labels, chat, task titles | `Instrument Sans` | Clean, modern without being generic |
| Time markers, durations | `DM Mono` | Precision, technical feel |

All via Google Fonts. Import in `index.html`.

### Motion

| Moment | Animation |
|---|---|
| View toggle (Kanban ↔ Gantt) | Cross-fade + 8px vertical shift, 200ms ease-out |
| Task blocks on load | Staggered fade-in left→right by row, 40ms delay between rows |
| Now-line | Amber opacity pulse 0.6→1→0.6, 3s loop |
| Block drag lift | scale(1.02) + drop shadow increase |
| Block drop | Spring settle, 150ms |

### Scope of change

The aesthetic refresh touches:
- `frontend/src/styles/globals.css` — new CSS variables, font imports
- `frontend/index.html` — Google Fonts `<link>` tags
- `Board.tsx`, `Column.tsx`, `TaskCard.tsx`, `ChatPanel.tsx` — updated Tailwind classes

No structural component changes for the aesthetic update.

---

## JSON Patch Reference

### New field patches (additive, no breakage)
```json
{ "op": "add", "path": "/columns/today/tasks/0/start_time", "value": "09:00" }
{ "op": "add", "path": "/columns/today/tasks/0/duration_minutes", "value": 60 }
```

### Breaking rename (`duration` → `duration_minutes`)
```json
{ "op": "remove", "path": "/columns/today/tasks/0/duration" }
{ "op": "add",    "path": "/columns/today/tasks/0/duration_minutes", "value": 60 }
```
This is the only breaking path change. The `set_full_plan` interceptor in `server.py` handles normalization.

---

## File Change Summary

| File | Change type |
|---|---|
| `project-planning-agent/schema.py` | `duration` → `duration_minutes`, add `start_time` |
| `project-planning-agent/agent_logic.py` | Load scheduling rules from config, update tool signatures |
| `project-planning-agent/config/scheduling_rules.md` | New file — agent placement rules |
| `project-planning-agent/server.py` | Duration normalization, `_assign_slot` helper, updated interceptors |
| `project-planning-agent/data/mock_calendar.json` | Normalize field names |
| `project-planning-agent/tools/actions.py` | Update `set_full_plan`, `add_task_to_plan`, `move_task_in_plan` signatures |
| `frontend/src/store/types.ts` | Mirror schema changes |
| `frontend/src/store/usePlannerStore.ts` | Add `viewMode`, update any `duration` references |
| `frontend/src/components/Board.tsx` | Add view toggle, render `KanbanBoard` or `GanttBoard` |
| `frontend/src/components/GanttBoard.tsx` | New |
| `frontend/src/components/GanttRow.tsx` | New |
| `frontend/src/components/GanttBlock.tsx` | New |
| `frontend/src/components/TimeRuler.tsx` | New |
| `frontend/src/styles/globals.css` | New CSS variables, dark theme |
| `frontend/index.html` | Google Fonts imports |
