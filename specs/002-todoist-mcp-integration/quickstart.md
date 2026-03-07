# Quickstart: Todoist Plan Export

**Feature**: 002-todoist-mcp-integration
**Date**: 2026-02-06
**Updated**: 2026-02-06 (Node.js MCP server, AppBridge host)

## Prerequisites

- Python 3.11+ installed
- Node.js 18+ installed
- A Todoist account with an API token ([find your token](https://www.todoist.com/help/articles/find-your-api-token-Jpzx9IIlB))
- The existing planner backend and frontend running (see main project README)

## Setup

### 1. Get your Todoist API Token

1. Open Todoist Settings > Integrations > Developer
2. Copy your personal API token
3. Add it to the MCP server environment:

```bash
# In todoist-mcp-server/.env
TODOIST_API_TOKEN=your_token_here
```

### 2. Install and Build the MCP Server

```bash
cd todoist-mcp-server
npm install
npm run build    # Builds the MCP App editor via Vite + vite-plugin-singlefile
```

Key dependencies installed:
- `@modelcontextprotocol/sdk` — MCP server framework
- `@modelcontextprotocol/ext-apps` — MCP Apps SDK (`registerAppTool`, `registerAppResource`, `App` class)
- `zod` — Schema validation
- `vite` + `vite-plugin-singlefile` — Bundles the editor into a single HTML file

### 3. Install Backend Dependencies

```bash
cd project-planning-agent
pip install -r requirements.txt
```

New dependency added by this feature:
- `httpx>=0.27.0` — Async HTTP client for calling the MCP server

### 4. Install Frontend Dependencies

```bash
cd frontend
npm install
```

New dependency added by this feature:
- `@modelcontextprotocol/ext-apps` — AppBridge host protocol for rendering MCP Apps in iframes

### 5. Start All Services

Start all three processes (each in a separate terminal):

**Terminal 1 — MCP Server** (port 3001):
```bash
cd todoist-mcp-server
npm run serve
```

**Terminal 2 — Planner Backend** (port 8000):
```bash
cd project-planning-agent
uvicorn server:app --reload --port 8000
```

**Terminal 3 — Frontend** (port 5173):
```bash
cd frontend
npm run dev
```

## Usage

### Export a Plan to Todoist

1. Open the planner at `http://localhost:5173`
2. Create a 3-day plan by chatting with the agent (e.g., "Plan my day")
3. When satisfied with the plan, type: **"Save this plan to Todoist"**
4. The agent will:
   - Ask you to confirm the project name (or use default)
   - Call the MCP server to export active tasks to Todoist
   - The tool result includes `_mcpApp` metadata
5. The frontend detects `_mcpApp` and renders the embedded editor:
   - An iframe appears inline in the chat
   - Shows tasks grouped by day (Today, Tomorrow, Next Day)
   - Styled to match the chat panel theme via host CSS variables
6. Review tasks in the editor:
   - Edit titles by clicking on them
   - Reorder tasks by dragging
   - Move tasks between day groups
7. Click **Save** to commit changes to Todoist

### Verify in Todoist

After export, open Todoist and find the new project. You should see:
- Three sections: "Today", "Tomorrow", "Next Day"
- Your planner tasks in each section, in the order you arranged them

## Architecture Summary

```
┌─────────────────────────┐
│  Frontend (React)       │
│  - ChatPanel            │
│  - McpAppFrame          │◄── AppBridge host (postMessage protocol)
│  - useAppBridge hook    │         │
└────────┬────────────────┘         │ postMessage (JSON-RPC)
         │ SSE (AG-UI events)       │
         │                    ┌─────┴──────────────────┐
┌────────┴────────────────┐   │  MCP App (iframe)      │
│  Planner Backend        │   │  - editor.html         │
│  (Python/FastAPI)       │   │  - App class lifecycle  │
│  - server.py            │   │  - app.callServerTool() │
│  - _MCP_APP_REGISTRY    │   └────────────────────────┘
│  - _mcpApp enrichment   │
└────────┬────────────────┘
         │ HTTP (JSON-RPC)
┌────────┴────────────────┐
│  MCP Server (Node.js)   │
│  - registerAppTool      │
│  - registerAppResource  │
│  - todoist-client.ts    │
└────────┬────────────────┘
         │ REST API
┌────────┴────────────────┐
│  Todoist API            │
│  (api.todoist.com)      │
└─────────────────────────┘
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Authentication error" in chat | Invalid or expired Todoist API token | Re-check token in `todoist-mcp-server/.env` and restart MCP server |
| Editor doesn't appear | MCP server not running or `_mcpApp` not in tool result | Check MCP server is running on port 3001; check server.py `_MCP_APP_REGISTRY` |
| Editor appears but is blank | Build not run; HTML resource not bundled | Run `npm run build` in `todoist-mcp-server/` |
| Editor not styled correctly | `onhostcontextchanged` not handling theme | Check browser console for AppBridge errors |
| Tasks not appearing in Todoist | API rate limit hit | Wait 15 minutes and retry |
| "Project not found" error | Project was deleted in Todoist | Export to a new project instead |
| Iframe blocked by browser | CSP or sandbox issue | Check browser console for security errors |
| Save fails in editor | MCP server unreachable from iframe | Verify MCP server URL in `_mcpApp.mcpServerUrl`; check CORS |

## Environment Variables

| Variable | Where | Required | Description | Default |
|----------|-------|----------|-------------|---------|
| `TODOIST_API_TOKEN` | MCP server `.env` | Yes | Todoist personal API token | — |
| `AGENT_MODEL` | Planner backend `.env` | No | LLM model name | `gpt-4o` |
| `MCP_SERVER_URL` | Planner backend `.env` | No | MCP server base URL | `http://localhost:3001/mcp` |
| `TODOIST_API_BASE` | MCP server `.env` | No | Todoist API base URL (for testing) | `https://api.todoist.com/rest/v2` |

## Development

### Rebuild MCP App After Changes

```bash
cd todoist-mcp-server
npm run build    # Re-bundles editor.html via Vite
npm run serve    # Restart to pick up new bundle
```

### Testing with basic-host

Test the MCP App independently using the SDK's basic-host example:

```bash
# Clone the SDK examples
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps

# Run basic-host against your MCP server
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```
