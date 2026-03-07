# Tasks: Todoist Plan Export

**Input**: Design documents from `/specs/002-todoist-mcp-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested in the specification. Test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, and basic structure for all three components (MCP server, backend extensions, frontend extensions).

- [x] T001 Create `todoist-mcp-server/` directory with `package.json` including dependencies: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`, `dotenv` as runtime deps and `tsx`, `typescript`, `vite`, `vite-plugin-singlefile` as dev deps in `todoist-mcp-server/package.json`
- [x] T002 Create `todoist-mcp-server/tsconfig.json` with Node.js + ESM target configuration (ES2022, NodeNext module resolution)
- [x] T003 [P] Create `todoist-mcp-server/vite.config.ts` with `vite-plugin-singlefile` to bundle `editor.html` into a single self-contained HTML file
- [x] T004 [P] Create `todoist-mcp-server/.env.example` with `TODOIST_API_TOKEN=` and `TODOIST_API_BASE=https://api.todoist.com/rest/v2` placeholders
- [x] T005 [P] Create `todoist-mcp-server/.gitignore` excluding `node_modules/`, `dist/`, `.env`
- [x] T006 [P] Add `httpx>=0.27.0` to `project-planning-agent/requirements.txt`
- [x] T007 [P] Add `@modelcontextprotocol/ext-apps` to `frontend/package.json` dependencies
- [x] T008 Run `npm install` in `todoist-mcp-server/` and `frontend/` to install new dependencies

**Checkpoint**: All three projects have dependencies installed and build configs ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented. This includes the Todoist API client, MCP server skeleton, data models, and frontend store extensions.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T009 Create Zod schemas for Todoist API data types (TodoistProject, TodoistSection, TodoistTask) in `todoist-mcp-server/models.ts` per `contracts/todoist-api.md` data types
- [x] T010 Implement TodoistClient class in `todoist-mcp-server/todoist-client.ts` with methods: `createProject`, `getProject`, `listProjects`, `createSection`, `listSections`, `createTask`, `updateTask`, `deleteTask`, `listTasks` per `contracts/todoist-api.md` interface; include typed error classes (TodoistAuthError, TodoistNotFoundError, TodoistRateLimitError, TodoistApiError, TodoistValidationError), Bearer token auth, `X-Request-Id` idempotency headers, and 30s timeout
- [x] T011 Create MCP server skeleton in `todoist-mcp-server/server.ts`: instantiate `McpServer` with name `todoist-planner` and version `1.0.0`, set up Streamable HTTP transport on port 3001 at `/mcp`, add CORS headers, load `TODOIST_API_TOKEN` from `.env` via dotenv, export `server` instance. Add `"serve": "tsx server.ts"` and `"build": "vite build"` scripts to `package.json`
- [x] T012 [P] Add ExportSession and snapshot types to `project-planning-agent/schema.py`: add `ExportStatus` enum (pending, writing, written, editing, saved, error), `SnapshotTask` model, `DaySnapshot` model, `FinalizedSnapshot` model, and `ExportSession` model per `data-model.md` entity definitions
- [x] T013 [P] Add McpAppMessage type and export session types to `frontend/src/store/types.ts`: add `McpAppMessage` interface with fields `toolCallId`, `resourceUri`, `mcpServerUrl`, `toolResult` per `contracts/ag-ui-events.md` Zustand store extensions
- [x] T014 Extend Zustand store in `frontend/src/store/usePlannerStore.ts`: add `mcpAppMessages: McpAppMessage[]` state, `addMcpAppMessage(msg: McpAppMessage): void` action, `removeMcpAppMessage(toolCallId: string): void` action per `contracts/ag-ui-events.md` store extensions
- [x] T015 Add `_export_store: Dict[str, ExportSession] = {}` global dict to `project-planning-agent/server.py` alongside the existing `_state_store` dict, following the same thread-based isolation pattern
- [x] T016 [P] Add `_MCP_APP_REGISTRY` dict to `project-planning-agent/server.py` mapping tool names to MCP App metadata per `contracts/ag-ui-events.md` server-side registry: `{"todoist_mcp": {"resourceUri": "ui://todoist-planner/editor.html", "mcpServerUrl": "http://localhost:3001/mcp"}}`

**Checkpoint**: Foundation ready — Todoist client, MCP server skeleton, data models, and store extensions in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Export Plan to Todoist (Priority: P1)

**Goal**: Users can tell the agent "Save this plan to Todoist" and have their active tasks written to a Todoist project organized by day sections.

**Independent Test**: Create a 3-day plan via chat, tell agent to save to Todoist, verify tasks appear in Todoist with correct sections (Today, Tomorrow, Next Day).

### Implementation for User Story 1

- [x] T017 [P] [US1] Implement `write_plan_to_todoist` tool in `todoist-mcp-server/server.ts` using `registerAppTool`: accept `project_name` (string), `project_id` (optional string), and `snapshot` (object with `days.today`, `days.tomorrow`, `days.next` each containing `DaySnapshot`); create project if no `project_id`, create 3 sections (Today order=0, Tomorrow order=1, Next Day order=2), create tasks in each section in order preserving planner metadata in description field (`planner_id:{id} type:{type} source:{source}`); return `{status, project_id, project_name, sections, task_count, task_mapping}` as text content; set `_meta.ui.resourceUri` to `ui://todoist-planner/editor.html` with `visibility: ["model"]` per `contracts/mcp-tools.md`
- [x] T018 [P] [US1] Create `project-planning-agent/tools/todoist.py` with `todoist_mcp` LangChain tool: compute `FinalizedSnapshot` from current `PlannerState` (filter out done/skipped tasks from all 3 columns, preserve order), serialize snapshot, call MCP server via `httpx.AsyncClient` POST to `{MCP_SERVER_URL}` with JSON-RPC `tools/call` for `write_plan_to_todoist`, parse and return MCP result; read `MCP_SERVER_URL` from env (default `http://localhost:3001/mcp`)
- [x] T019 [US1] Register `todoist_mcp` tool in `project-planning-agent/agent_logic.py`: import from `tools.todoist`, add to the tools list, extend `SYSTEM_PROMPT` with instructions for when to call `todoist_mcp` (when user says "save to todoist", "export plan", etc.) and how to confirm project name with user first per FR-004 and FR-017
- [x] T020 [US1] Add `todoist_mcp` interceptor in `project-planning-agent/server.py` state interceptor block (inside `stream_agent_events` where other tool names like `move_task_in_plan` are handled): when `tool_name == "todoist_mcp"` and result is success, create/update `ExportSession` in `_export_store[thread_id]`, check `_MCP_APP_REGISTRY` for `_mcpApp` metadata, enrich the tool result dict with `_mcpApp: {resourceUri, mcpServerUrl}` before the `ToolCallEndEvent` is emitted; do NOT emit any `STATE_DELTA` events (per FR-013 no planner state mutation)
- [x] T021 [US1] Extend `onToolCallEndEvent` handler in `frontend/src/hooks/useAgUiPlanner.ts`: after calling `store.endToolCall(event.toolCallId)`, parse `event.toolCallResult` as JSON, check if parsed result contains `_mcpApp` property, if so call `store.addMcpAppMessage({ toolCallId, resourceUri: result._mcpApp.resourceUri, mcpServerUrl: result._mcpApp.mcpServerUrl, toolResult: result })` per `contracts/ag-ui-events.md` detection logic

**Checkpoint**: User Story 1 is functional — agent can export plan to Todoist, result enriched with `_mcpApp`. The MCP App editor (US2) is not yet rendered but the data pipeline is complete.

---

## Phase 4: User Story 2 — Review and Edit Before Saving (Priority: P2)

**Goal**: After export, an embedded editor appears inline in chat showing tasks by day. Users can edit titles, reorder tasks, move between days, and save changes back to Todoist.

**Independent Test**: Export a plan, verify editor iframe appears in chat with tasks grouped by day, edit a task title, click Save, verify change persists in Todoist.

### Implementation for User Story 2

- [x] T022 [P] [US2] Implement `fetch_todoist_project` tool in `todoist-mcp-server/server.ts` using `registerAppTool` with `visibility: ["app"]` and `resourceUri: editorUri`: accept `project_id` (string), fetch project + sections + tasks from TodoistClient, return structured response with sections and tasks organized by section per `contracts/mcp-tools.md`
- [x] T023 [P] [US2] Implement `update_todoist_project` tool in `todoist-mcp-server/server.ts` using `registerAppTool` with `visibility: ["app"]` and `resourceUri: editorUri`: accept `project_id` (string) and `changes` (array of `{action, task_id, new_content?, new_section_id?, new_order?}`), apply changes to Todoist via TodoistClient (`update_title` → updateTask, `move_section` → updateTask with section_id, `reorder` → delete+recreate in order), return `{status, updated_count, failed_count?, errors?}` per `contracts/mcp-tools.md`
- [x] T024 [P] [US2] Register MCP App resource in `todoist-mcp-server/server.ts`: use `registerAppResource` to serve `ui://todoist-planner/editor.html` with MIME type `application/x-mcp-app+html` (via `RESOURCE_MIME_TYPE` constant), read the bundled HTML from `dist/editor.html` at startup
- [x] T025 [US2] Create MCP App editor entry point `todoist-mcp-server/editor.html` with minimal HTML5 boilerplate that loads `src/editor.ts` via Vite
- [x] T026 [US2] Implement editor app in `todoist-mcp-server/src/editor.ts` using `App` class from `@modelcontextprotocol/ext-apps`: register all lifecycle handlers BEFORE `app.connect()`: `app.ontoolinput` (show loading state with project name), `app.ontoolresult` (parse result, render tasks grouped by section — Today/Tomorrow/Next Day), `app.onhostcontextchanged` (call `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` from SDK, handle `safeAreaInsets` padding), `app.onteardown` (return unsaved changes if any); implement task rendering with inline title editing (contenteditable or input on click), drag-and-drop reordering within and across day groups, Save button that collects changes and calls `app.callServerTool("update_todoist_project", {project_id, changes})`, Refresh button that calls `app.callServerTool("fetch_todoist_project", {project_id})`; style using host CSS variables (`var(--color-background-secondary)`, `var(--color-text-primary)`, etc.) per `contracts/mcp-tools.md` editor capabilities
- [x] T027 [US2] Create `frontend/src/hooks/useAppBridge.ts` hook implementing the AppBridge host protocol per `contracts/ag-ui-events.md`: accept `{iframeRef, mcpServerUrl, toolResult, hostContext}`, manage postMessage listener for JSON-RPC from iframe, send `ui/initialize` with hostContext on iframe ready, push tool result via `ui/notifications/tool-result`, handle incoming `tools/call` requests by proxying to MCP server via `fetch(mcpServerUrl)`, handle `ui/requestDisplayMode` (toggle inline/fullscreen + send updated hostContext), handle `ui/updateModelContext`, handle `ui/sendLog` (log to browser console), manage `ui/teardown` on unmount; return `{isReady, sendToolResult, sendHostContext, teardown}`
- [x] T028 [US2] Create `frontend/src/components/McpAppFrame.tsx` component: accept props `{resourceUri, mcpServerUrl, toolResult}`; on mount fetch resource HTML via `GET {mcpServerUrl}` with JSON-RPC `resources/read` for `resourceUri`, render `<iframe srcdoc={html} sandbox="allow-scripts" />`, use `useAppBridge` hook to manage lifecycle; pass hostContext with theme (based on planner global_tone), CSS variables, font declarations, safeAreaInsets `{top:0, right:0, bottom:0, left:0}`, displayMode "inline", availableDisplayModes `["inline", "fullscreen"]`; handle fullscreen toggle by updating iframe container styles; cleanup on unmount via `teardown()`
- [x] T029 [US2] Extend `ChatPanel.tsx` to render `McpAppFrame` components: import McpAppFrame and `mcpAppMessages` from store; in the messages rendering loop, after rendering chat messages and before the tool calls section, render `mcpAppMessages` as `<McpAppFrame>` components interleaved in the chat timeline per `contracts/ag-ui-events.md` ChatPanel rendering spec

**Checkpoint**: User Story 2 is functional — embedded editor appears inline in chat after export, users can edit titles, reorder, and save back to Todoist.

---

## Phase 5: User Story 3 — Error Recovery During Export (Priority: P3)

**Goal**: Todoist errors (network, auth, rate limit) surface as clear messages. No planner data is lost. Users can retry.

**Independent Test**: Simulate Todoist service failure during export (e.g., remove API token), verify user sees clear error, planner state unchanged, can retry after fixing.

### Implementation for User Story 3

- [x] T030 [P] [US3] Add error handling to `todoist-mcp-server/todoist-client.ts`: wrap all HTTP calls in try/catch, parse Todoist error responses (`error_tag`, `error_code`, `error`, `error_extra`), throw typed exceptions (TodoistAuthError for 401/403, TodoistNotFoundError for 404, TodoistRateLimitError for 429 with `Retry-After` header parsing, TodoistApiError for 5xx with up to 3 retries using exponential backoff, TodoistValidationError for 400) per `contracts/todoist-api.md` error handling spec
- [x] T031 [P] [US3] Add error handling to `write_plan_to_todoist` tool in `todoist-mcp-server/server.ts`: catch all TodoistClient exceptions, return structured error responses with `{status: "error", error_type: "auth_error|api_error|rate_limit", message: "Human-readable error message"}` and `isError: true` per `contracts/mcp-tools.md` error output schema
- [x] T032 [P] [US3] Add error handling to `fetch_todoist_project` and `update_todoist_project` tools in `todoist-mcp-server/server.ts`: same error response pattern as T031
- [x] T033 [US3] Add error display to MCP App editor in `todoist-mcp-server/src/editor.ts`: show error banners when `app.ontoolresult` receives an error result (`status: "error"`), display human-readable error messages, show Retry button for recoverable errors, show re-authentication guidance for auth errors per FR-013 and FR-014
- [x] T034 [US3] Add error handling to `todoist_mcp` interceptor in `project-planning-agent/server.py`: when MCP server returns error or is unreachable (`httpx` connection error), update `ExportSession.status` to `error`, do NOT enrich with `_mcpApp` on error, let the agent receive the error result and communicate it to the user via text message
- [x] T035 [US3] Add partial failure handling to `update_todoist_project` tool in `todoist-mcp-server/server.ts`: when some changes succeed and others fail, return `{status: "partial", updated_count, failed_count, errors: [{task_id, message}]}` per `contracts/mcp-tools.md` partial failure output; editor should display which tasks failed

**Checkpoint**: User Story 3 is functional — all error scenarios produce clear, recoverable messages. Planner state remains unchanged.

---

## Phase 6: User Story 4 — Export to Existing Project (Priority: P4)

**Goal**: Users can re-export to an existing Todoist project, updating tasks rather than duplicating them.

**Independent Test**: Export a plan, modify it, export again to same project, verify tasks updated (not duplicated) in Todoist.

### Implementation for User Story 4

- [x] T036 [P] [US4] Extend `write_plan_to_todoist` tool in `todoist-mcp-server/server.ts`: when `project_id` is provided, fetch existing project and sections via TodoistClient, match existing tasks by `planner_id` in description metadata, update matched tasks (title, section), create new tasks for unmatched planner tasks, use `X-Request-Id` for idempotency per `research.md` R10 and `data-model.md` task mapping rules
- [x] T037 [P] [US4] Extend `todoist_mcp` tool in `project-planning-agent/tools/todoist.py`: check `_export_store[thread_id]` for existing `ExportSession` with a `todoist_project_id`, if found pass it as `project_id` to MCP server to enable update-not-duplicate behavior
- [x] T038 [US4] Extend agent system prompt in `project-planning-agent/agent_logic.py`: add instructions for the agent to detect previous exports (via export session state context) and offer the user a choice between updating the existing project or creating a new one per US4 acceptance scenario 1

**Checkpoint**: User Story 4 is functional — re-exporting updates existing project tasks instead of duplicating.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, edge cases, and production readiness.

- [x] T039 [P] Handle empty plan edge case in `project-planning-agent/tools/todoist.py`: when `FinalizedSnapshot` has zero active tasks across all days, return early with message informing user to add tasks first (per spec Edge Case 1)
- [x] T040 [P] Add unsaved changes warning to MCP App editor in `todoist-mcp-server/src/editor.ts`: in `app.onteardown` handler, if user has pending edits return `{unsavedChanges: pendingChanges}` so host can warn before navigation (per spec Edge Case 4)
- [x] T041 [P] Add `MCP_SERVER_URL` environment variable support to `project-planning-agent/.env.example` with default `http://localhost:3001/mcp`
- [x] T042 [P] Add CORS configuration to `todoist-mcp-server/server.ts` to allow requests from frontend origin (`http://localhost:5173`) for resource fetching and tool proxying from `McpAppFrame`
- [x] T043 Validate end-to-end flow per `quickstart.md`: start all 3 services, create a plan, export to Todoist, verify editor appears, edit and save, verify in Todoist
- [x] T044 [P] Add `IntersectionObserver` visibility management to `frontend/src/components/McpAppFrame.tsx`: pause/unpause iframe when scrolled out of viewport to avoid unnecessary resource consumption per MCP Apps best practices

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 completion — No dependencies on other stories
- **US2 (Phase 4)**: Depends on Phase 2 completion — Can start in parallel with US1 for MCP server tools (T022-T024) and editor (T025-T026), but McpAppFrame rendering (T027-T029) depends on US1's `_mcpApp` enrichment (T020-T021)
- **US3 (Phase 5)**: Depends on Phase 2 completion — Can start in parallel for error handling in MCP server (T030-T032), but interceptor and editor error display (T033-T034) depend on US1 and US2 respectively
- **US4 (Phase 6)**: Depends on US1 completion (T017-T020) — extends the write tool and agent tool
- **Polish (Phase 7)**: Depends on US1-US3 being complete

### Within Each User Story

- MCP server tools before agent tools (agent calls MCP server)
- Agent tool before server interceptor (interceptor handles tool results)
- Store extensions before UI components (components read from store)
- Hook before component (component uses hook)

### Critical Path

```
T001-T008 (Setup) → T009-T016 (Foundation) → T017-T020 (US1: MCP+Agent) → T021 (US1: Frontend) → T027-T029 (US2: AppBridge+Frame+ChatPanel)
```

### Parallel Opportunities

**Phase 1** — all [P] tasks (T003-T007) can run in parallel after T001-T002:
```
T001 → T002 → [T003, T004, T005, T006, T007] → T008
```

**Phase 2** — backend and frontend extensions in parallel:
```
T009 → T010 → T011 (MCP server, sequential)
[T012, T013, T016] in parallel (different projects/files)
T013 → T014 (store types before store impl)
```

**Phase 3 (US1)** — MCP server tool and agent tool in parallel, then frontend:
```
[T017, T018] in parallel → T019 → T020 → T021
```

**Phase 4 (US2)** — MCP tools, editor, and frontend in parallel where possible:
```
[T022, T023, T024] in parallel (MCP server tools+resource)
T025 → T026 (editor HTML → editor TS)
T027 → T028 → T029 (hook → component → ChatPanel)
```

**Phase 5 (US3)** — all error handling tasks in parallel:
```
[T030, T031, T032] in parallel → [T033, T034, T035]
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Export plan to Todoist, verify tasks in Todoist project
5. The `_mcpApp` metadata is in the tool result but no editor renders yet — that's OK for MVP

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. User Story 1 → Export works → Validate in Todoist (MVP!)
3. User Story 2 → Embedded editor renders → Edit and save works
4. User Story 3 → Error handling → Graceful failures
5. User Story 4 → Re-export updates → No duplicates
6. Polish → Edge cases, production readiness

### Suggested MVP Scope

**User Story 1 alone** is a complete, testable increment. Users can export plans to Todoist via chat command. The `_mcpApp` metadata is included in the response for future editor rendering, and the data pipeline is proven end-to-end.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- The MCP server is a separate Node.js process on port 3001 — must be running for all Todoist operations
- The MCP App editor is a Vite-bundled single-file HTML served as a `ui://` resource
- No planner state mutations during any Todoist operation (FR-013)
- Total tasks: 44
