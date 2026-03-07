# Implementation Plan: Todoist Plan Export

**Branch**: `002-todoist-mcp-integration` | **Date**: 2026-02-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-todoist-mcp-integration/spec.md`

## Summary

Extend the Rolling 3-Day AI Planner with the ability to export finalized plans to Todoist via a custom MCP server with MCP Apps support. The MCP server is built in TypeScript/Node.js using the official `@modelcontextprotocol/ext-apps` SDK, which provides `registerAppTool` and `registerAppResource` for embedding interactive UIs inside the chat panel. The integration adds four new components: a Todoist MCP server (Node.js, separate process), an MCP App editor (Vite-bundled single-file HTML), an agent tool extension (`todoist_mcp` in the Python backend), and an AppBridge host implementation in the React frontend that dynamically detects and renders MCP App UIs from tool call results.

## Technical Context

**Language/Version**: Python 3.11+ (planner backend), TypeScript 5.9 (MCP server + frontend)
**Primary Dependencies**:
- Planner Backend: FastAPI, LangChain v1, Pydantic v2, ag-ui-protocol, httpx (calls MCP server)
- MCP Server: @modelcontextprotocol/sdk, @modelcontextprotocol/ext-apps, zod, node-fetch or built-in fetch (Todoist API)
- MCP App: @modelcontextprotocol/ext-apps (client App class), vite, vite-plugin-singlefile
- Frontend: React 19, Zustand 5, fast-json-patch, @modelcontextprotocol/ext-apps (AppBridge host)
**Storage**: In-memory dict per thread (existing pattern); Todoist API as external persistence
**Testing**: pytest (planner backend), vitest (MCP server + frontend)
**Target Platform**: Desktop web browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: Web application (frontend + backend + MCP server)
**Performance Goals**: Export to Todoist within 10 seconds; embedded editor loads within 3 seconds
**Constraints**: Todoist API rate limit of 1,000 requests per 15 minutes per user; MCP App runs in sandboxed iframe
**Scale/Scope**: Single-user, single-project export per session; ~30 tasks max per 3-day plan

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is not yet configured (template only). No gates to evaluate. Proceeding with standard engineering best practices:

- **Simplicity**: Extending existing patterns (signal → interceptor → STATE_DELTA) rather than introducing new architectural paradigms
- **Separation of concerns**: MCP server (Node.js) handles Todoist API + MCP Apps; AG-UI server (Python) handles state sync + tool interception; frontend handles rendering + AppBridge hosting
- **No planner state mutation**: Todoist operations never modify planner state (spec FR-013)
- **Additive only**: No existing planner behavior is changed
- **Dynamic MCP App discovery**: Frontend detects MCP Apps via `_mcpApp` metadata in tool results — no hardcoded tool-to-UI mappings

## Project Structure

### Documentation (this feature)

```text
specs/002-todoist-mcp-integration/
├── plan.md              # This file
├── research.md          # Phase 0: Technology decisions
├── data-model.md        # Phase 1: Entity definitions and mappings
├── quickstart.md        # Phase 1: Setup and run instructions
├── contracts/           # Phase 1: API contracts
│   ├── mcp-tools.md     # MCP server tool definitions
│   ├── ag-ui-events.md  # AG-UI event handling + AppBridge protocol
│   └── todoist-api.md   # Todoist API wrapper interface
└── tasks.md             # Phase 2: Implementation tasks (created by /speckit.tasks)
```

### Source Code (repository root)

```text
todoist-mcp-server/                  # NEW: Node.js MCP server (separate process)
├── server.ts                        # MCP server with registerAppTool/registerAppResource
├── todoist-client.ts                # Todoist REST API v2 wrapper
├── models.ts                        # Zod schemas for Todoist data
├── src/                             # MCP App source (Vite project)
│   └── editor.ts                    # Editor app (vanilla JS + App class)
├── editor.html                      # Entry HTML for Vite
├── vite.config.ts                   # Vite + vite-plugin-singlefile config
├── package.json                     # Node.js dependencies
└── tsconfig.json                    # TypeScript config

project-planning-agent/
├── server.py                        # Extended: todoist tool interceptor + _mcpApp enrichment
├── agent_logic.py                   # Extended: todoist_mcp tool registration
├── schema.py                        # Extended: export session state
├── tools/
│   └── todoist.py                   # NEW: Agent tool (calls MCP server via HTTP)
└── requirements.txt                 # Extended: httpx

frontend/
├── src/
│   ├── components/
│   │   ├── ChatPanel.tsx            # Extended: detect _mcpApp in tool results, render McpAppFrame
│   │   └── McpAppFrame.tsx          # NEW: AppBridge host (iframe + full MCP Apps lifecycle)
│   ├── store/
│   │   ├── usePlannerStore.ts       # Extended: export session state + mcpApp tracking
│   │   └── types.ts                 # Extended: McpAppMessage type, export session types
│   └── hooks/
│       └── useAppBridge.ts          # NEW: AppBridge host hook (postMessage protocol, tool proxying)
└── package.json                     # Extended: @modelcontextprotocol/ext-apps
```

**Structure Decision**: The MCP server is a **separate Node.js process** rather than mounted on the Python FastAPI app. This is required because the official MCP Apps SDK (`registerAppTool`, `registerAppResource`) is TypeScript-only. The Python planner agent calls the MCP server via HTTP. The MCP App HTML is built with Vite + `vite-plugin-singlefile` and served by the MCP server as a `ui://` resource. The frontend implements the AppBridge host protocol from `@modelcontextprotocol/ext-apps` to dynamically render any MCP App returned by any tool call.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| Separate Node.js process for MCP server | MCP Apps SDK (`registerAppTool`, `registerAppResource`) is TypeScript-only | Python MCP SDK lacks App registration helpers; manual implementation would be fragile and undocumented |
| AppBridge host in frontend | MCP Apps spec requires the host to manage iframe lifecycle, postMessage protocol, tool proxying, theming | Simple iframe + postMessage relay doesn't handle the full MCP Apps lifecycle (init, teardown, context changes, display modes) |
| Vite build for MCP App | MCP Apps must be served as single-file HTML bundles | Vanilla HTML works for trivial apps but the editor needs drag-and-drop and structured state management |
