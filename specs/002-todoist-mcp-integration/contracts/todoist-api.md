# Todoist API Wrapper Contract: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06

## Overview

A thin Python wrapper around the Todoist REST API v2, used by the MCP server to perform CRUD operations on projects, sections, and tasks.

**Base URL**: `https://api.todoist.com/rest/v2`
**Auth**: Bearer token via `Authorization: Bearer {TODOIST_API_TOKEN}`

---

## TodoistClient Interface

### Constructor

```
TodoistClient(api_token: str)
```

- Validates token is non-empty
- Creates HTTP client with default headers and timeout (30s)

---

### Projects

#### `create_project(name: str, view_style: str = "list") -> TodoistProject`

Creates a new Todoist project.

**Todoist API**: `POST /rest/v2/projects`
**Request Body**: `{ "name": "...", "view_style": "list" }`
**Returns**: `TodoistProject { id, name, view_style }`
**Errors**: 400 (invalid name), 403 (quota exceeded)

#### `get_project(project_id: str) -> TodoistProject`

Fetches a single project by ID.

**Todoist API**: `GET /rest/v2/projects/{project_id}`
**Returns**: `TodoistProject { id, name, view_style }`
**Errors**: 404 (project not found)

#### `list_projects() -> list[TodoistProject]`

Lists all projects for the authenticated user.

**Todoist API**: `GET /rest/v2/projects`
**Returns**: List of `TodoistProject`

---

### Sections

#### `create_section(project_id: str, name: str, order: int = 0) -> TodoistSection`

Creates a new section within a project.

**Todoist API**: `POST /rest/v2/sections`
**Request Body**: `{ "project_id": "...", "name": "...", "order": 0 }`
**Returns**: `TodoistSection { id, project_id, name, order }`
**Errors**: 400 (invalid project_id), 404 (project not found)

#### `list_sections(project_id: str) -> list[TodoistSection]`

Lists all sections in a project.

**Todoist API**: `GET /rest/v2/sections?project_id={project_id}`
**Returns**: List of `TodoistSection`

---

### Tasks

#### `create_task(content: str, project_id: str, section_id: str, description: str = "", request_id: str | None = None) -> TodoistTask`

Creates a new task in a project section.

**Todoist API**: `POST /rest/v2/tasks`
**Request Body**: `{ "content": "...", "project_id": "...", "section_id": "...", "description": "..." }`
**Headers**: `X-Request-Id: {request_id}` (if provided, for idempotency)
**Returns**: `TodoistTask { id, content, project_id, section_id, description, order }`
**Errors**: 400 (invalid input), 403 (task limit exceeded)

#### `update_task(task_id: str, content: str | None = None, section_id: str | None = None, description: str | None = None) -> TodoistTask`

Updates an existing task. Only provided fields are changed.

**Todoist API**: `POST /rest/v2/tasks/{task_id}`
**Request Body**: `{ "content": "...", "section_id": "..." }` (only changed fields)
**Returns**: `TodoistTask { id, content, project_id, section_id, description, order }`
**Errors**: 400 (invalid input), 404 (task not found)

#### `delete_task(task_id: str) -> None`

Deletes a task.

**Todoist API**: `DELETE /rest/v2/tasks/{task_id}`
**Returns**: None (204 No Content)
**Errors**: 404 (task not found)

#### `list_tasks(project_id: str, section_id: str | None = None) -> list[TodoistTask]`

Lists active tasks in a project, optionally filtered by section.

**Todoist API**: `GET /rest/v2/tasks?project_id={project_id}&section_id={section_id}`
**Returns**: List of `TodoistTask`

---

## Data Types

### TodoistProject

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist project ID |
| `name` | string | Project display name |
| `view_style` | string | "list" or "board" |

### TodoistSection

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist section ID |
| `project_id` | string | Parent project ID |
| `name` | string | Section name |
| `order` | integer | Display order |

### TodoistTask

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Todoist task ID |
| `content` | string | Task title |
| `project_id` | string | Parent project ID |
| `section_id` | string | Parent section ID |
| `description` | string | Metadata (planner_id, type, source) |
| `order` | integer | Position in section (read-only) |

---

## Error Handling

All methods raise typed exceptions:

| Exception | Todoist HTTP Status | Recovery |
|-----------|-------------------|----------|
| `TodoistAuthError` | 401, 403 | Prompt user to re-enter API token |
| `TodoistNotFoundError` | 404 | Project or task was deleted externally |
| `TodoistRateLimitError` | 429 | Retry after `Retry-After` header seconds |
| `TodoistApiError` | 5xx | Retry up to 3 times with exponential backoff |
| `TodoistValidationError` | 400 | Surface validation message to user |

### Error Response Parsing

Todoist error responses follow this format:
```json
{
  "error_tag": "INVALID_ARGUMENT",
  "error_code": 400,
  "error": "Human-readable message",
  "http_code": 400,
  "error_extra": {
    "argument": "field_name",
    "explanation": "Detailed explanation"
  }
}
```

The wrapper extracts `error` and `error_extra.explanation` for user-facing messages.

---

## Rate Limiting

- **Limit**: 1,000 requests per user per 15-minute window
- **Strategy**: Track request count locally; preemptively error if approaching limit
- **Typical usage per export**: ~10-20 requests (1 project + 3 sections + 5-15 tasks)
- **Typical usage per save**: ~1-5 requests (only changed tasks)

---

## Idempotency

- All `create_task` calls include `X-Request-Id` headers using `uuid.uuid4().hex[:36]`
- If a create request is retried with the same ID, Todoist returns the previously created task
- This prevents duplicate task creation on network retries
