# AG-UI Events Contract: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06
**Updated**: 2026-02-08 (AG-UI protocol alignment — `_mcpApp` via TOOL_CALL_RESULT)

## Overview

The Todoist export flow uses existing AG-UI event types. No new event types are defined. MCP App rendering is triggered dynamically when the frontend detects `_mcpApp` metadata in a `TOOL_CALL_RESULT` event's `content` — no hardcoded tool-to-UI mappings in the frontend.

## Event Sequence: Export to Todoist

```
User: "Save this plan to Todoist"
│
├─ RUN_STARTED
│    { type: "RUN_STARTED", runId: "..." }
│
├─ STATE_SNAPSHOT
│    { type: "STATE_SNAPSHOT", snapshot: { ...current planner state... } }
│
├─ TEXT_MESSAGE_START
│    { type: "TEXT_MESSAGE_START", messageId: "msg-1", role: "assistant" }
│
├─ TEXT_MESSAGE_CONTENT (streamed)
│    { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1",
│      delta: "I'll export your plan to Todoist..." }
│
├─ TEXT_MESSAGE_END
│    { type: "TEXT_MESSAGE_END", messageId: "msg-1" }
│
├─ TOOL_CALL_START
│    { type: "TOOL_CALL_START",
│      toolCallId: "tc-1",
│      toolCallName: "todoist_mcp",
│      toolCallArgs: { project_name: "3-Day Plan - Feb 6", ... } }
│    → Frontend shows ToolCallPill: "Todoist Mcp..."
│
├─ TOOL_CALL_END
│    { type: "TOOL_CALL_END", toolCallId: "tc-1" }
│    → Frontend removes ToolCallPill
│
├─ TOOL_CALL_RESULT ★ (contains _mcpApp in content)
│    { type: "TOOL_CALL_RESULT",
│      messageId: "msg-tool-1",
│      toolCallId: "tc-1",
│      content: JSON.stringify({
│        status: "success",
│        project_id: "2345678",
│        task_count: 12,
│        _mcpApp: {
│          resourceUri: "ui://todoist-planner/editor.html",
│          mcpServerUrl: "http://localhost:3001/mcp"
│        }
│      }),
│      role: "tool" }
│    → Frontend detects _mcpApp in parsed event.content
│    → Frontend launches AppBridge host + renders McpAppFrame
│
├─ TEXT_MESSAGE_START
│    { type: "TEXT_MESSAGE_START", messageId: "msg-2", role: "assistant" }
│
├─ TEXT_MESSAGE_CONTENT (streamed)
│    { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-2",
│      delta: "Your plan has been exported. Review and edit in the editor above, then click Save." }
│
├─ TEXT_MESSAGE_END
│    { type: "TEXT_MESSAGE_END", messageId: "msg-2" }
│
└─ RUN_FINISHED
     { type: "RUN_FINISHED", runId: "..." }
```

## Dynamic MCP App Detection via `_mcpApp`

### How It Works

1. The Python AG-UI server (`server.py`) intercepts `todoist_mcp` tool results
2. Server knows this tool has an associated MCP App (configured via a server-side registry)
3. Server enriches the tool result with `_mcpApp` metadata and emits `TOOL_CALL_RESULT` with the enriched JSON in `content` (per AG-UI protocol; `TOOL_CALL_END` carries only `toolCallId`)
4. Frontend parses every `TOOL_CALL_RESULT` and checks `event.content` for `_mcpApp`
5. If found, frontend launches the AppBridge host and renders the MCP App

### `_mcpApp` Payload Schema

```json
{
  "_mcpApp": {
    "resourceUri": "ui://todoist-planner/editor.html",
    "mcpServerUrl": "http://localhost:3001/mcp"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `resourceUri` | string | The `ui://` URI of the MCP App resource to fetch and render |
| `mcpServerUrl` | string | Base URL of the MCP server (for resource fetching and tool proxying) |

### Why This Is Dynamic

- The frontend has **one generic handler**: "If any `TOOL_CALL_RESULT` content contains `_mcpApp`, render an MCP App frame using `resourceUri` and `mcpServerUrl`"
- **No per-tool hardcoding** in the frontend
- Registering a new MCP App on a server only requires:
  1. Adding the tool and resource on the MCP server
  2. Adding the `_mcpApp` enrichment in the AG-UI server interceptor
  3. The frontend renders it automatically — zero frontend code changes

## Server-Side Interceptor Extension

The existing tool result interceptor in `server.py` is extended:

```
Tool: todoist_mcp
  │
  ├── Call MCP server via HTTP: POST http://localhost:3001/mcp
  │    (invoke write_plan_to_todoist tool)
  │
  ├── Parse MCP result: { status, project_id, task_mapping, ... }
  │
  ├── Store export session in _export_store[thread_id]
  │
  ├── Enrich result with _mcpApp metadata:
  │    result["_mcpApp"] = {
  │      "resourceUri": "ui://todoist-planner/editor.html",
  │      "mcpServerUrl": "http://localhost:3001/mcp"
  │    }
  │
  ├── Emit TOOL_CALL_END (toolCallId only)
  ├── Emit TOOL_CALL_RESULT with enriched result in content
  │    → Frontend detects _mcpApp in event.content, renders McpAppFrame
  │
  └── Emit TEXT_MESSAGE with explanation text
```

### Server-Side MCP App Registry

The AG-UI server maintains a simple mapping of which agent tools have associated MCP Apps:

```python
_MCP_APP_REGISTRY = {
    "todoist_mcp": {
        "resourceUri": "ui://todoist-planner/editor.html",
        "mcpServerUrl": "http://localhost:3001/mcp"
    }
    # Future MCP Apps are added here — no frontend changes needed
}
```

When intercepting a tool result, the server checks if `tool_name in _MCP_APP_REGISTRY` and enriches accordingly.

## Frontend: AppBridge Host Protocol

### Detection in `onToolCallResult`

```
onToolCallResultEvent(event):
  result = JSON.parse(event.content)

  if (result._mcpApp):
    store.addMcpAppMessage({
      toolCallId: event.toolCallId,
      resourceUri: result._mcpApp.resourceUri,
      mcpServerUrl: result._mcpApp.mcpServerUrl,
      toolResult: result
    })
    → ChatPanel renders <McpAppFrame> for this message
```

### McpAppFrame Component (AppBridge Host)

The `McpAppFrame` component implements the **host side** of the MCP Apps protocol, following the `examples/basic-host/` reference from the SDK:

```
McpAppFrame mounts:
  1. Fetch resource HTML:
     GET {mcpServerUrl}/resources/{resourceUri}
     → Returns bundled HTML string

  2. Create sandboxed iframe:
     <iframe srcdoc={html} sandbox="allow-scripts" />

  3. Initialize AppBridge (via useAppBridge hook):
     a. Listen for postMessage from iframe
     b. On iframe ready, send ui/initialize:
        { jsonrpc: "2.0", method: "ui/initialize", params: { hostContext } }
     c. Send hostContext with:
        - theme (light/dark based on planner tone)
        - styles.variables (CSS variable map)
        - styles.css.fonts (font declarations)
        - safeAreaInsets ({ top: 0, right: 0, bottom: 0, left: 0 })
        - availableDisplayModes ["inline", "fullscreen"]
        - displayMode "inline"

  4. Push tool result to iframe:
     { jsonrpc: "2.0", method: "ui/notifications/tool-result",
       params: { content: toolResult.content } }
     → Editor's app.ontoolresult fires

  5. Handle incoming requests from iframe:
     a. tools/call (app.callServerTool):
        - Proxy to MCP server: POST {mcpServerUrl}/tools/call
        - Return result to iframe via postMessage
     b. ui/requestDisplayMode:
        - Toggle fullscreen/inline mode
        - Send updated hostContext
     c. ui/updateModelContext:
        - Store context for future LLM turns
     d. ui/sendLog:
        - Log to browser console for debugging

  6. On unmount (teardown):
     - Send ui/teardown to iframe
     - Wait for response (unsaved changes check)
     - Cleanup postMessage listeners
```

### useAppBridge Hook

Encapsulates the postMessage protocol so `McpAppFrame` stays clean:

```
useAppBridge({ iframeRef, mcpServerUrl, toolResult, hostContext })
  Returns:
    - isReady: boolean (iframe initialized)
    - sendToolResult(result): void
    - sendHostContext(ctx): void
    - teardown(): Promise<TeardownResult>
```

### Zustand Store Extensions

```typescript
interface McpAppMessage {
  toolCallId: string;
  resourceUri: string;
  mcpServerUrl: string;
  toolResult: any;
}

// New store actions:
addMcpAppMessage(msg: McpAppMessage): void
removeMcpAppMessage(toolCallId: string): void

// New store state:
mcpAppMessages: McpAppMessage[]
```

### ChatPanel Rendering

```
For each item in the chat timeline:
  if item is McpAppMessage:
    Render <McpAppFrame
      resourceUri={item.resourceUri}
      mcpServerUrl={item.mcpServerUrl}
      toolResult={item.toolResult}
    />
  else if item is ChatMessage:
    Render standard text message (existing behavior)
  else if item is ToolCall:
    Render ToolCallPill (existing behavior)
```

## No Planner State Mutation

**Critical**: The Todoist export flow NEVER emits `STATE_DELTA` events that modify the planner state. The planner board remains exactly as-is throughout the export process. Export session state is tracked separately in `_export_store` and is not part of `PlannerState`.
