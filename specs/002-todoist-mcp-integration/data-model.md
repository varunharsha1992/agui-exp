# Data Model: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06

## Entity Relationship Overview

```
PlannerState (existing)
    │
    ├── columns.today.tasks[]  ──┐
    ├── columns.tomorrow.tasks[] ├── filter (exclude done/skipped) ──► FinalizedSnapshot
    └── columns.next.tasks[]   ──┘                                        │
                                                                          │ serialize
                                                                          ▼
                                                                    TodoistProject
                                                                        │
                                                                        ├── sections[] (Today, Tomorrow, Next Day)
                                                                        │     └── tasks[]
                                                                        │
                                                                        └── ExportSession (tracks mapping)
                                                                              ├── planner_task_id → todoist_task_id
                                                                              └── section mappings
```

## Entities

### FinalizedSnapshot (New)

A point-in-time capture of active planner tasks prepared for Todoist export.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `snapshot_id` | string | Unique ID for this snapshot | Auto-generated UUID |
| `thread_id` | string | Session thread this snapshot belongs to | Must match active session |
| `created_at` | datetime | When the snapshot was taken | Auto-set on creation |
| `global_tone` | VisualTone | Plan's visual tone at snapshot time | Enum: calm, neutral, tight |
| `days` | dict[string, DaySnapshot] | Tasks per day | Keys: today, tomorrow, next |
| `include_skipped` | boolean | Whether skipped tasks are included | Default: false |

### DaySnapshot (New)

Tasks for a single day in the finalized snapshot.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `day` | string | Day identifier | Enum: today, tomorrow, next |
| `label` | string | Human-readable day name | Non-empty string |
| `tasks` | list[SnapshotTask] | Ordered list of active tasks | Excludes done; excludes skipped unless include_skipped=true |

### SnapshotTask (New)

A task within a finalized snapshot, ready for mapping to Todoist.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `planner_id` | string | Original task ID from planner | Non-empty, unique within snapshot |
| `title` | string | Task title | Non-empty string |
| `type` | TaskType | Fixed or flexible | Enum: fixed, flexible |
| `source` | string (optional) | Origin of the task | Enum: calendar, email, user |
| `duration` | string (optional) | Estimated duration | Format: "30m", "1h", etc. |
| `order` | integer | Position within the day | 0-indexed, unique within day |

### ExportSession (New)

Tracks the lifecycle of a plan-to-Todoist export, including ID mappings for updates.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `session_id` | string | Unique export session ID | Auto-generated UUID |
| `thread_id` | string | Planner session this export belongs to | Must match active session |
| `snapshot_id` | string | The finalized snapshot being exported | Must reference valid snapshot |
| `todoist_project_id` | string (optional) | Target Todoist project ID | Set after project creation/selection |
| `todoist_project_name` | string | Project name in Todoist | Non-empty string |
| `section_mapping` | dict[string, string] | Day → Todoist section ID | Keys: today, tomorrow, next |
| `task_mapping` | dict[string, string] | Planner task ID → Todoist task ID | Populated after write |
| `status` | ExportStatus | Current export state | Enum: pending, writing, written, editing, saved, error |
| `error` | string (optional) | Error message if status is error | Set only on failure |
| `created_at` | datetime | When the session started | Auto-set |
| `updated_at` | datetime | Last status change | Auto-updated |

### ExportStatus (New Enum)

| Value | Description |
|-------|-------------|
| `pending` | Snapshot taken, awaiting Todoist write |
| `writing` | Writing tasks to Todoist in progress |
| `written` | Tasks written to Todoist; editor can open |
| `editing` | User is reviewing/editing in embedded editor |
| `saved` | User has saved final edits to Todoist |
| `error` | An error occurred; recoverable |

### TodoistProject (External — Todoist API representation)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist project ID |
| `name` | string | Project display name |
| `view_style` | string | "list" (default for planner exports) |

### TodoistSection (External — Todoist API representation)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist section ID |
| `project_id` | string | Parent project |
| `name` | string | Section name (e.g., "Today", "Tomorrow", "Next Day") |
| `order` | integer | Display order (0=Today, 1=Tomorrow, 2=Next Day) |

### TodoistTask (External — Todoist API representation)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist task ID |
| `content` | string | Task title (maps from planner `title`) |
| `project_id` | string | Parent project |
| `section_id` | string | Parent section (determines day grouping) |
| `description` | string | Metadata (planner_id, type, source stored here) |
| `order` | integer | Position within section (read-only in REST API) |

## State Transitions

### Export Session Lifecycle

```
[User: "Save to Todoist"]
    │
    ▼
  pending ──── snapshot created, project confirmed
    │
    ▼
  writing ──── creating sections + tasks via Todoist API
    │
    ├── error ──► (recoverable, user can retry)
    │
    ▼
  written ──── MCP App editor opens inline
    │
    ▼
  editing ──── user reviewing/modifying in editor
    │
    ├── error ──► (save failed, user can retry)
    │
    ▼
  saved ──── user clicked Save, changes committed to Todoist
```

## Task Mapping Rules

### Planner → Todoist (Export)

| Planner Field | Todoist Field | Transformation |
|---------------|---------------|----------------|
| `task.title` | `task.content` | Direct copy |
| `column.id` (today/tomorrow/next) | `task.section_id` | Map via `section_mapping` |
| `task.id` | `task.description` | Store as metadata: `planner_id:{id}` |
| `task.type` | `task.description` | Append: `type:{fixed\|flexible}` |
| `task.source` | `task.description` | Append: `source:{calendar\|email\|user}` |
| `task.duration` | `task.description` | Append: `duration:{value}` |
| Position in `tasks[]` | Creation order | Create tasks in order to preserve ordering |

### Todoist → Editor (Display)

| Todoist Field | Editor Display | Notes |
|---------------|----------------|-------|
| `task.content` | Editable title field | User can modify |
| `task.section_id` | Day group heading | User can move between groups |
| `task.order` | Display position | User can reorder via drag |
| `task.description` | Hidden metadata | Parsed for planner_id, type, source |

### Editor → Todoist (Save)

| Editor Change | Todoist API Call | Notes |
|---------------|-----------------|-------|
| Title edited | `POST /tasks/{id}` with new `content` | Only if changed |
| Task reordered | Delete + recreate in new order | REST API limitation |
| Task moved to different day | `POST /tasks/{id}` with new `section_id` | Section ID from mapping |

## Extended Planner State

The existing `PlannerState` is NOT modified. Export state is tracked separately per thread:

```python
# Server-side storage (same pattern as _state_store)
_export_store: Dict[str, ExportSession] = {}  # thread_id → ExportSession
```

This separation ensures spec requirement FR-013: Todoist operations never mutate planner state.
