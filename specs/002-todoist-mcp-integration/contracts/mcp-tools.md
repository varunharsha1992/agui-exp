# MCP Tools Contract: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06
**Updated**: 2026-02-06 (MCP Apps SDK alignment)

## MCP Server: `todoist-planner`

**Runtime**: Node.js / TypeScript
**SDK**: `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`
**Transport**: Streamable HTTP (JSON-RPC over HTTP) on port 3001
**Base URL**: `http://localhost:3001/mcp`

### Server Registration Pattern

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

const server = new McpServer({ name: "todoist-planner", version: "1.0.0" });
const editorUri = "ui://todoist-planner/editor.html";

// Tool with UI (model-visible) — registered via registerAppTool
registerAppTool(server, "write_plan_to_todoist", { ... });

// Tools without UI (app-only) — registered via registerAppTool with visibility
registerAppTool(server, "fetch_todoist_project", { ..., _meta: { ui: { resourceUri: editorUri, visibility: ["app"] } } });
registerAppTool(server, "update_todoist_project", { ..., _meta: { ui: { resourceUri: editorUri, visibility: ["app"] } } });

// Resource serving the bundled editor HTML
registerAppResource(server, editorUri, editorUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({ contents: [{ uri: editorUri, mimeType: RESOURCE_MIME_TYPE, text: bundledHtml }] })
);
```

---

## Tool: `write_plan_to_todoist`

**Purpose**: Write a finalized plan snapshot to a Todoist project, creating the project and sections if needed. Returns project data that the MCP App editor will display.

**Visibility**: `["model"]` — called by the LLM agent, not by the MCP App

**`_meta.ui`**: `{ resourceUri: "ui://todoist-planner/editor.html" }` — host renders the editor after this tool completes

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "project_name": {
      "type": "string",
      "description": "Name for the Todoist project (e.g., '3-Day Plan - Feb 6')"
    },
    "project_id": {
      "type": "string",
      "description": "Existing Todoist project ID to update. If null, creates a new project."
    },
    "snapshot": {
      "type": "object",
      "description": "Finalized plan snapshot",
      "properties": {
        "days": {
          "type": "object",
          "properties": {
            "today": { "$ref": "#/definitions/DaySnapshot" },
            "tomorrow": { "$ref": "#/definitions/DaySnapshot" },
            "next": { "$ref": "#/definitions/DaySnapshot" }
          }
        }
      }
    }
  },
  "required": ["project_name", "snapshot"]
}
```

**Output** (success — text fallback for non-UI hosts):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\": \"success\", \"project_id\": \"2345678\", \"project_name\": \"3-Day Plan - Feb 6\", \"sections\": {\"today\": \"sec_1\", \"tomorrow\": \"sec_2\", \"next\": \"sec_3\"}, \"task_count\": 12, \"task_mapping\": {\"planner-id-1\": \"todoist-id-1\"}}"
  }]
}
```

**Output** (error):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\": \"error\", \"error_type\": \"auth_error|api_error|rate_limit\", \"message\": \"Human-readable error message\"}"
  }],
  "isError": true
}
```

**MCP App Lifecycle**: After this tool completes:
1. Host receives tool result via `TOOL_CALL_END`
2. Host detects `_meta.ui.resourceUri` on this tool (via `_mcpApp` enrichment in AG-UI result)
3. Host fetches `ui://todoist-planner/editor.html` resource from MCP server
4. Host renders iframe with bundled HTML
5. Host sends `ui/initialize` to iframe
6. Host pushes tool result to iframe via `ui/notifications/tool-result`
7. Editor's `app.ontoolresult` handler receives project data and renders it

---

## Tool: `fetch_todoist_project`

**Purpose**: Fetch the current state of a Todoist project (sections and tasks). Called by the MCP App editor to refresh content.

**Visibility**: `["app"]` — called only by the MCP App iframe, hidden from the LLM agent

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Todoist project ID to fetch"
    }
  },
  "required": ["project_id"]
}
```

**Output** (success):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\": \"success\", \"project\": {\"id\": \"2345678\", \"name\": \"3-Day Plan\", \"sections\": [{\"id\": \"sec_1\", \"name\": \"Today\", \"tasks\": [{\"id\": \"task_1\", \"content\": \"Team standup\", \"order\": 0, \"description\": \"planner_id:abc123 type:fixed source:calendar\"}]}]}}"
  }]
}
```

**Called from editor via**: `app.callServerTool({ name: "fetch_todoist_project", arguments: { project_id: "..." } })`

---

## Tool: `update_todoist_project`

**Purpose**: Apply user edits from the embedded editor to Todoist. Called when user clicks Save in the MCP App.

**Visibility**: `["app"]` — called only by the MCP App iframe, hidden from the LLM agent

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Todoist project ID to update"
    },
    "changes": {
      "type": "array",
      "description": "List of changes to apply",
      "items": {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "enum": ["update_title", "move_section", "reorder"]
          },
          "task_id": {
            "type": "string",
            "description": "Todoist task ID"
          },
          "new_content": {
            "type": "string",
            "description": "New title (for update_title)"
          },
          "new_section_id": {
            "type": "string",
            "description": "Target section ID (for move_section)"
          },
          "new_order": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Ordered list of task IDs (for reorder)"
          }
        },
        "required": ["action", "task_id"]
      }
    }
  },
  "required": ["project_id", "changes"]
}
```

**Output** (success):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\": \"success\", \"updated_count\": 3, \"message\": \"3 tasks updated in Todoist\"}"
  }]
}
```

**Output** (partial failure):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\": \"partial\", \"updated_count\": 2, \"failed_count\": 1, \"errors\": [{\"task_id\": \"123\", \"message\": \"Task not found\"}]}"
  }]
}
```

**Called from editor via**: `app.callServerTool({ name: "update_todoist_project", arguments: { project_id: "...", changes: [...] } })`

---

## MCP App Resource: `ui://todoist-planner/editor.html`

**Purpose**: Embedded HTML/CSS/JS editor for reviewing and editing Todoist project content.

**MIME Type**: `application/x-mcp-app+html` (via `RESOURCE_MIME_TYPE` constant)

**Build**: Vite + `vite-plugin-singlefile` → single self-contained HTML file

### Required Lifecycle Handlers

All handlers MUST be registered BEFORE calling `app.connect()`:

```typescript
const app = new App({ name: "Todoist Editor", version: "1.0.0" });

// 1. Receive tool input (loading preview while API calls in flight)
app.ontoolinput = (params) => {
  showLoadingState(params.arguments?.project_name);
};

// 2. Receive tool result (project data to render)
app.ontoolresult = (result) => {
  const data = JSON.parse(result.content[0].text);
  renderProjectEditor(data);
};

// 3. Handle host context changes (theme, safe area, display mode)
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};

// 4. Cleanup on teardown (warn about unsaved changes)
app.onteardown = async () => {
  if (hasUnsavedChanges) {
    // Return state for potential restoration
    return { unsavedChanges: pendingChanges };
  }
  return {};
};

await app.connect();
```

### Editor Capabilities

- Displays tasks grouped by section (day: Today, Tomorrow, Next Day)
- Supports inline title editing (click to edit)
- Supports drag-and-drop reordering within and across day groups
- Calls `app.callServerTool("update_todoist_project", changes)` on Save
- Calls `app.callServerTool("fetch_todoist_project", {project_id})` to refresh
- Displays error states with retry capability
- Uses host CSS variables (`var(--color-background-secondary)`, `var(--color-text-primary)`, etc.) for theme integration

### Permissions

None required (no microphone, camera, or external network access — all communication goes through the host via `app.callServerTool()`)

### CSP

Default (no external origins needed — all content is self-contained in the bundled HTML)

---

## DaySnapshot Definition

```json
{
  "type": "object",
  "properties": {
    "day": { "type": "string", "enum": ["today", "tomorrow", "next"] },
    "label": { "type": "string" },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "planner_id": { "type": "string" },
          "title": { "type": "string" },
          "type": { "type": "string", "enum": ["fixed", "flexible"] },
          "source": { "type": "string", "enum": ["calendar", "email", "user"] },
          "duration": { "type": "string" },
          "order": { "type": "integer" }
        },
        "required": ["planner_id", "title", "type", "order"]
      }
    }
  },
  "required": ["day", "label", "tasks"]
}
```
