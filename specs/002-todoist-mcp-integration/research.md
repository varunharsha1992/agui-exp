# Research: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06

## R1: Todoist API Choice

**Decision**: Use Todoist REST API v2 with Bearer token authentication

**Rationale**:
- REST API v2 is simpler than the Sync API and sufficient for our CRUD operations
- Bearer token auth (personal API token) is the simplest path for a single-user integration
- OAuth 2.0 would be needed for a multi-user SaaS product but is out of scope per assumptions
- The v2 API provides all needed operations: projects, sections, and tasks CRUD

**Alternatives Considered**:
- **Todoist Sync API**: More powerful (supports explicit task reordering via `item_reorder`), but significantly more complex with batched commands and incremental sync. Overkill for one-directional export.
- **Todoist Unified API v1**: Todoist's newest API. While recommended for new integrations, REST v2 has better documentation coverage and is sufficient for our scope. Can migrate later if needed.
- **OAuth 2.0 auth**: Required for multi-user apps. Adds complexity (token exchange, refresh, storage). Since we're single-user and the token can be stored as an environment variable, Bearer token is appropriate.

---

## R2: Day-to-Section Mapping Strategy

**Decision**: Create three Todoist sections per project — "Today", "Tomorrow", "Next Day" — and assign tasks via `section_id`

**Rationale**:
- Sections are the natural Todoist primitive for grouping tasks within a project
- Maps cleanly to the planner's three-column model
- Section names are human-readable in Todoist's UI
- Task `section_id` can be updated to move tasks between days
- Sections have an `order` field for consistent display

**Alternatives Considered**:
- **Project per day**: Creates clutter in Todoist; harder to manage as a single "plan"
- **Labels per day**: Labels are flat (no hierarchy); don't group visually in Todoist's list view
- **Due dates**: Would map planner days to calendar dates. Promising but adds complexity (need to compute actual dates from "today/tomorrow/next") and was explicitly deferred in spec assumptions.
- **Task name prefix** (e.g., "[TODAY] Buy groceries"): Fragile, pollutes task titles, breaks if user edits title in Todoist

---

## R3: Task Ordering Within Sections

**Decision**: Rely on creation order within sections; accept that explicit reordering requires the Sync API

**Rationale**:
- REST API v2 does not support explicit task reordering (the `order` field is read-only)
- Creating tasks in the desired order produces the correct initial display
- For the embedded editor's reorder feature, we can delete and recreate tasks in the new order, or use the Sync API's `item_reorder` command
- Given the small number of tasks per section (~5-10), the delete-and-recreate approach is acceptable for v1

**Alternatives Considered**:
- **Sync API `item_reorder`**: Most correct approach but adds Sync API dependency alongside REST API. Can be added in a future iteration.
- **Todoist `order` field manipulation**: Not supported in REST API v2.

---

## R4: MCP Server Architecture

**Decision**: Build a custom MCP server in TypeScript/Node.js as a separate process, using the official `@modelcontextprotocol/ext-apps` SDK with `registerAppTool` and `registerAppResource`

**Rationale**:
- The MCP Apps SDK (`@modelcontextprotocol/ext-apps/server`) provides `registerAppTool` and `registerAppResource` — these are the standard way to register tools with associated UI resources and are **TypeScript/Node.js only**
- The Python MCP SDK supports base MCP protocol (tools + resources) but lacks the App registration helpers; manually implementing `_meta.ui.resourceUri`, the `ui://` scheme, and the correct MIME type (`application/x-mcp-app+html`) would be fragile and undocumented
- A separate Node.js process communicates with the Python planner backend via HTTP, keeping concerns cleanly separated
- The MCP server runs on its own port (e.g., 3001) and the Python agent calls it via `httpx`

**Alternatives Considered**:
- **Python MCP server mounted on FastAPI**: Shares the process (simpler deployment) but lacks `registerAppTool`/`registerAppResource`. Would require manually implementing the MCP Apps protocol fields, which is error-prone as the spec evolves.
- **FastMCP Python library**: Higher-level abstraction with FastAPI integration, but also lacks MCP Apps support.
- **Agent-direct Todoist calls** (no MCP): Would work for export but doesn't support the embedded editor requirement. The MCP Apps spec requires an MCP server to serve the `ui://` resource.

---

## R5: MCP App Editor Implementation

**Decision**: Build the editor as a Vite project using `vite-plugin-singlefile`, bundled into a single HTML file and served via `registerAppResource` at the `ui://todoist-planner/editor.html` URI

**Rationale**:
- MCP Apps spec requires HTML content served via `ui://` resource URI as a single self-contained file
- `vite-plugin-singlefile` is the standard MCP Apps build tool — all SDK examples use it
- The editor uses `@modelcontextprotocol/ext-apps` client `App` class for communication with the host
- Full lifecycle handler registration is required **before** `app.connect()`:
  - `app.ontoolinput` — receives tool arguments (shows loading preview while Todoist API calls are in flight)
  - `app.ontoolresult` — receives tool result data (project content to display)
  - `app.onhostcontextchanged` — receives theme, safe area insets, display mode (styles editor to match host)
  - `app.onteardown` — cleanup (warns about unsaved changes per spec edge case)
- User edits are sent back to the MCP server via `app.callServerTool()` which proxies through the host
- Host styling integration via `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` ensures the editor visually matches the chat panel
- Safe area insets (`ctx.safeAreaInsets`) must be respected for proper padding

**Alternatives Considered**:
- **Vanilla HTML (no build)**: Works for trivial apps but the editor needs imports (`@modelcontextprotocol/ext-apps`), structured state, and drag-and-drop. A build step is unavoidable.
- **React-based editor with `useApp` hook**: The SDK provides a React hook, but adds React as a dependency inside the MCP App iframe. Vanilla JS + `App` class is lighter.
- **External editor URL**: MCP Apps must be self-contained and served by the MCP server, not loaded from external URLs.
- **Todoist embed/widget**: Todoist doesn't offer an embeddable widget for project editing.

---

## R6: Agent Tool Design

**Decision**: Add a single `todoist_mcp` LangChain tool that the agent calls to initiate the export flow

**Rationale**:
- Follows the existing pattern of agent tools returning signals
- The tool computes the finalized snapshot (excluding done/skipped tasks) and calls the MCP server
- The MCP server writes to Todoist and returns an MCP App definition
- The server interceptor detects the MCP App response and emits it as a special message type in the AG-UI event stream
- This keeps the agent simple: it calls one tool, the infrastructure handles the rest

**Alternatives Considered**:
- **Multiple agent tools** (finalize, write, fetch, update): More granular but the agent would need to orchestrate a multi-step workflow. The MCP server handles the multi-step logic internally, keeping the agent interface simple.
- **Direct Todoist API calls from agent tools**: Bypasses MCP entirely. Works for export but doesn't support the embedded editor requirement.

---

## R7: MCP App Rendering in Chat Panel

**Decision**: The AG-UI server enriches `TOOL_CALL_END` results with `_mcpApp` metadata when a tool has an associated MCP App. The frontend generically detects `_mcpApp` in any tool result and renders a `McpAppFrame` component that implements the full AppBridge host protocol.

**Rationale**:
- **Dynamic discovery**: The server includes `_mcpApp: { resourceUri, mcpServerUrl }` in the `TOOL_CALL_END` result payload. The frontend has a single generic handler: "If any tool result contains `_mcpApp`, render an MCP App frame." No per-tool hardcoding in the frontend. Registering a new MCP App on the server automatically makes it renderable.
- **AppBridge host**: The `McpAppFrame` component implements the full host side of the MCP Apps protocol per the `examples/basic-host/` reference:
  - Fetches HTML resource from the MCP server via the `resourceUri`
  - Renders in sandboxed iframe via `srcdoc`
  - Sends `ui/initialize` JSON-RPC to the iframe
  - Pushes tool results via `ui/notifications/tool-result`
  - Handles `tools/call` requests from the iframe (proxies to MCP server)
  - Sends `hostContextChanged` with theme variables, safe area insets, and display mode
  - Handles `ui/requestDisplayMode` for fullscreen toggle
  - Handles `ui/updateModelContext` if the app updates LLM context
  - Manages teardown when the component unmounts
- **`useAppBridge` hook**: Encapsulates the postMessage protocol, JSON-RPC dispatch, and MCP server proxying so `McpAppFrame` stays clean

**Alternatives Considered**:
- **`[MCP_APP:...]` text marker in TEXT_MESSAGE_CONTENT**: Server-driven (good) but pollutes chat history with rendering instructions, fragile regex parsing, marker persists on reload causing stale editor re-renders. Replaced by `_mcpApp` in tool results.
- **Hardcoded tool-name-to-UI mapping in frontend**: Defeats dynamism — every new MCP App would require a frontend code change. Rejected.
- **Frontend discovers tools via MCP `tools/list` at startup**: Dynamic but adds an extra protocol layer (frontend speaking MCP directly). The server already knows which tools have UIs, so enriching the tool result is simpler.
- **Modal/overlay editor**: Disrupts the chat flow; spec requires "inline in chat" rendering (FR-006)
- **Separate page/route**: Loses conversation context; spec requires maintaining chat context (FR-015)
- **Direct DOM rendering** (no iframe): Security risk; MCP Apps spec mandates sandboxed iframe

---

## R8: Authentication Token Management

**Decision**: Store Todoist API token as a server-side environment variable (`TODOIST_API_TOKEN`)

**Rationale**:
- Single-user scope means one token per deployment
- Environment variables are the standard pattern for API secrets
- The token never reaches the frontend
- Backend reads it on startup and passes to the Todoist client

**Alternatives Considered**:
- **Per-user token storage in database**: Required for multi-user but out of scope
- **Frontend-initiated OAuth flow**: Would require token exchange, storage, and refresh logic. Appropriate for a SaaS product but unnecessary here.
- **Token in chat message**: Insecure; would be stored in conversation history

---

## R9: Error Handling Strategy

**Decision**: Todoist errors are caught at the MCP server level and returned as structured error responses; the MCP App displays them; planner state is never modified on error

**Rationale**:
- The MCP server wraps all Todoist API calls in try/except
- HTTP 4xx errors (invalid requests) return user-friendly messages
- HTTP 5xx errors (Todoist down) return retry-able error states
- Auth errors (401) return specific re-authentication guidance
- The MCP App editor shows error banners with retry buttons
- The planner's `_state_store` is never touched during Todoist operations (spec FR-013)

**Alternatives Considered**:
- **Propagate raw Todoist errors**: Too technical for users
- **Silent retry**: Could mask persistent issues; users should know when something fails

---

## R10: Idempotency for Todoist Writes

**Decision**: Use Todoist's `X-Request-Id` header for idempotent writes; track Todoist task IDs for updates

**Rationale**:
- Todoist REST API supports `X-Request-Id` (max 36 bytes) for POST idempotency
- On first export, tasks are created and their Todoist IDs are stored in the export session
- On re-export to the same project, tasks are matched by planner ID metadata and updated rather than duplicated
- This satisfies spec User Story 4 (export to existing project)

**Alternatives Considered**:
- **Delete all + recreate**: Simple but loses Todoist-side data (comments, completions, sub-tasks added by user)
- **Content-based matching**: Fragile if user edits titles in Todoist between exports
