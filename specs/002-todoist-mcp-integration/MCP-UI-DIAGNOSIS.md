# MCP App UI Not Rendering — Structured Diagnosis

**Date**: 2026-02-08  
**Issue**: MCP being called and Todoist updated successfully, but UI components (editor under `ui://todoist-planner/editor.html`) are not rendered in the chat component.

---

## 1. Component Compliance with Spec

### MCP Server (`todoist-mcp-server/server.ts`) ✅

| Check | Status | Details |
|-------|--------|---------|
| Editor URI | ✅ | `editorUri = "ui://todoist-planner/editor.html"` |
| Resource registration | ✅ | `registerAppResource(server, editorUri, ...)` |
| Tool `_meta.ui` | ✅ | `write_plan_to_todoist` has `_meta: { ui: { resourceUri: editorUri, visibility: ["model"] } }` |
| Resource MIME | ✅ | Uses `RESOURCE_MIME_TYPE` |
| editor.html | ✅ | Served from `DIST_DIR/editor.html` |

**Verdict**: MCP server components are aligned with the spec.

---

## 2. Backend Event Processing (`project-planning-agent/server.py`)

### Flow

1. Agent invokes `todoist_mcp` tool → returns signal `{"action": "export_to_todoist", "project_name": ...}`.
2. Interceptor `_handle_todoist_interceptor` runs.
3. MCP server is called; on success, result is enriched with `_mcpApp`.
4. `ToolCallEndEvent` is emitted with `tool_call_result=enriched_result`.

### Code Path

```python
# server.py lines 393-397
result_dict["_mcpApp"] = _MCP_APP_REGISTRY[tool_name]
return json.dumps(result_dict)

# server.py lines 610-615
yield encoder.encode(
    ToolCallEndEvent(
        type=EventType.TOOL_CALL_END,
        tool_call_id=tool_call_id,
        tool_call_result=enriched_result  # Contains _mcpApp
    )
)
```

**Verdict**: Backend correctly enriches the tool result and sends it in `TOOL_CALL_END`.

---

## 3. AG-UI Protocol Mismatch (Root Cause)

### Official AG-UI Event Definitions

From [docs.ag-ui.com/sdk/js/core/events](https://docs.ag-ui.com/sdk/js/core/events):

**ToolCallEndEvent** (current protocol):

```
type ToolCallEndEvent = BaseEvent & {
  type: "TOOL_CALL_END"
  toolCallId: string   // ← ONLY this field
}
```

**ToolCallResultEvent**:

```
type ToolCallResultEvent = BaseEvent & {
  type: "TOOL_CALL_RESULT"
  messageId: string
  toolCallId: string
  content: string      // ← Tool result lives HERE
  role?: "tool"
}
```

### Spec vs Protocol

`specs/002-todoist-mcp-integration/contracts/ag-ui-events.md` assumes:

```
TOOL_CALL_END with toolCallResult: JSON.stringify({ ... _mcpApp ... })
```

But in the AG-UI protocol:

- `TOOL_CALL_END` = completion signal only, no result payload.
- `TOOL_CALL_RESULT` = carries the tool result in `content`.

### What Happens in Practice

1. **Backend** emits `TOOL_CALL_END` with `tool_call_result` in the JSON.
2. **Frontend** parses via `EventSchemas.parse()` (Zod).
3. `ToolCallEndEventSchema` only defines `toolCallId` (and base fields).
4. Extra fields such as `tool_call_result` / `toolCallResult` are dropped during schema validation.
5. `onToolCallEndEvent` receives `event` where `event.toolCallResult` is `undefined`.
6. `store.addMcpAppMessage()` is never called.
7. `mcpAppMessages` stays empty, so no `McpAppFrame` is rendered.

**Verdict**: Root cause is a protocol mismatch — the result is sent inside `TOOL_CALL_END`, but the protocol expects it in `TOOL_CALL_RESULT`, and the client schema strips the extra field.

---

## 4. Frontend Handling

### useAgUiPlanner.ts

```typescript
onToolCallEndEvent: ({ event }) => {
  store.endToolCall(event.toolCallId);
  const toolCallResult = (event as Record<string, unknown>).toolCallResult as string | undefined;
  const result = JSON.parse(toolCallResult || '{}');
  if (result._mcpApp) {
    store.addMcpAppMessage({ ... });
  }
}
```

- Logic is correct: if `event.toolCallResult` contained the enriched JSON with `_mcpApp`, it would add an MCP app message.
- Because of the protocol/schema behavior, `event.toolCallResult` is never present.

### ChatPanel & McpAppFrame

- `mcpAppMessages` is read from the store and rendered as `McpAppFrame`.
- `McpAppFrame` and `useAppBridge` are wired to use `mcpApp.resourceUri`, `mcpServerUrl`, and `toolResult`.

**Verdict**: Frontend implementation matches the spec; the issue is that the expected payload never arrives due to the protocol mismatch.

---

## 5. Trace Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. User: "Save to Todoist"                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Agent calls todoist_mcp → returns signal                             │
│    Server interceptor calls MCP write_plan_to_todoist → SUCCESS          │
│    Todoist project created/updated ✓                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Server emits TOOL_CALL_END with tool_call_result (enriched JSON)      │
│    { toolCallId, tool_call_result: '{"status":"success","_mcpApp":...}' }│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Frontend parseSSEStream → JSON.parse → EventSchemas.parse()           │
│    ToolCallEndEventSchema only allows toolCallId                         │
│    → tool_call_result STRIPPED by Zod validation                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. onToolCallEndEvent receives { type, toolCallId }                      │
│    event.toolCallResult === undefined                                   │
│    → addMcpAppMessage() never called                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. mcpAppMessages = [] → No McpAppFrame rendered                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Recommended Fix

Backend should emit `TOOL_CALL_RESULT` instead of (or in addition to) putting the result in `TOOL_CALL_END`:

1. Emit `TOOL_CALL_END` with only `toolCallId` (per protocol).
2. Emit `TOOL_CALL_RESULT` with:
   - `messageId`: new UUID
   - `toolCallId`: same as the tool call
   - `content`: enriched JSON string (including `_mcpApp`)
   - `role`: `"tool"`

Frontend should detect `_mcpApp` in `TOOL_CALL_RESULT`:

1. Add `onToolCallResultEvent` handler in `useAgUiPlanner.ts`.
2. Parse `event.content` and check for `_mcpApp`.
3. If present, call `store.addMcpAppMessage()` with the parsed result.

---

## 7. Changes Required

### Backend (`project-planning-agent/server.py`)

| # | File | Change |
|---|------|--------|
| 1 | `server.py` | Import `ToolCallResultEvent` from `ag_ui.core` |
| 2 | `server.py` | When emitting tool result for `todoist_mcp` (and any tool with `_mcpApp`): emit `TOOL_CALL_END` with only `tool_call_id` (remove `tool_call_result`) |
| 3 | `server.py` | After `TOOL_CALL_END`, emit `TOOL_CALL_RESULT` with: `message_id` = new UUID, `tool_call_id` = same as tool call, `content` = enriched JSON string (with `_mcpApp`), `role` = `"tool"` |
| 4 | `server.py` | Apply the above to all tools whose results are enriched with `_mcpApp` (currently only `todoist_mcp` in the interceptor) |

### Frontend (`frontend/src/hooks/useAgUiPlanner.ts`)

| # | File | Change |
|---|------|--------|
| 5 | `useAgUiPlanner.ts` | Add `onToolCallResultEvent` handler (in addition to existing `onToolCallEndEvent`) |
| 6 | `useAgUiPlanner.ts` | In `onToolCallResultEvent`: parse `event.content` as JSON, check for `result._mcpApp` |
| 7 | `useAgUiPlanner.ts` | If `_mcpApp` present: call `store.addMcpAppMessage({ toolCallId, resourceUri, mcpServerUrl, toolResult })` |
| 8 | `useAgUiPlanner.ts` | Remove or simplify `_mcpApp` detection from `onToolCallEndEvent` (it will never receive it) |

### Spec / Contract Updates

| # | File | Change |
|---|------|--------|
| 9 | `contracts/ag-ui-events.md` | Update event sequence: document that `_mcpApp` is delivered via `TOOL_CALL_RESULT` (not `TOOL_CALL_END`) |
| 10 | `contracts/ag-ui-events.md` | Update detection logic: `onToolCallResultEvent` parses `event.content` for `_mcpApp` |

---

## 8. Changes Implemented (2026-02-08)

The fix described in sections 6 and 7 has been implemented:

### Backend ([project-planning-agent/server.py](project-planning-agent/server.py))

- Imported `ToolCallResultEvent` from `ag_ui.core` and `json` at module level.
- After computing `enriched_result`, the server checks whether the parsed result contains `_mcpApp`.
- If `_mcpApp` is present: emits `TOOL_CALL_END` with only `tool_call_id`, then emits `TOOL_CALL_RESULT` with `message_id`, `tool_call_id`, `content` (enriched JSON string), and `role: "tool"`. Broadcasts `TOOL_CALL_RESULT` to subscribers.
- If `_mcpApp` is absent: emits `TOOL_CALL_END` with `tool_call_result` as before (backwards compatible for non-MCP tools).

### Frontend ([frontend/src/hooks/useAgUiPlanner.ts](frontend/src/hooks/useAgUiPlanner.ts))

- `onToolCallEndEvent`: simplified to only call `store.endToolCall(event.toolCallId)`; removed `_mcpApp` detection.
- `onToolCallResultEvent`: added new handler that parses `event.content` as JSON, checks for `result._mcpApp`, and calls `store.addMcpAppMessage()` when present.

### Spec ([specs/002-todoist-mcp-integration/contracts/ag-ui-events.md](specs/002-todoist-mcp-integration/contracts/ag-ui-events.md))

- Updated overview, event sequence diagram, "How It Works", server interceptor description, and detection section to document that `_mcpApp` is delivered via `TOOL_CALL_RESULT` (not `TOOL_CALL_END`).
- Renamed "Detection in onToolCallEnd" to "Detection in onToolCallResult" and updated the logic to use `onToolCallResultEvent` and `event.content`.

---

## 9. Quick Verification

Add temporary logging in `useAgUiPlanner.ts`:

```typescript
onToolCallEndEvent: ({ event }) => {
  console.log('[DEBUG] TOOL_CALL_END event keys:', Object.keys(event));
  console.log('[DEBUG] toolCallResult:', (event as any).toolCallResult);
  // ...
}
```

Expected (before fix): `toolCallResult` would be `undefined`, confirming the payload was stripped before reaching the handler.

After fix: `onToolCallResultEvent` receives `event.content` with the full enriched JSON including `_mcpApp`, and the MCP App frame renders correctly.
