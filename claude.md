# Claude Code Context

This file provides context for Claude Code when working on this project.

## Project Overview

**Rolling 3-Day AI Planner** - A collaborative productivity tool using the AG-UI Protocol for real-time bidirectional state synchronization between an AI agent and the UI.

Users interact via text chat or voice to manage tasks across three days (Today, Tomorrow, Next). The AI agent can fetch calendar/email data, move tasks, and adjust the visual tone based on workload.

## Directory Structure

```
agui-exp/
├── project-planning-agent/    # Python backend (FastAPI + LangChain)
│   ├── server.py              # Main server with AG-UI protocol translation
│   ├── agent_logic.py         # LangChain agent definition
│   ├── schema.py              # Pydantic models for shared state
│   ├── tools/                 # Agent tools (calendar, email, actions)
│   └── data/                  # Mock data (calendar, emails)
├── frontend/                  # React + TypeScript + Vite
│   ├── src/components/        # ChatPanel, Board, Column, TaskCard
│   ├── src/hooks/             # useAgUiPlanner, useVoiceMode, useStateSubscription
│   └── src/store/             # Zustand store with JSON Patch support
├── livekit-adaptor/           # Voice agent (LiveKit SDK)
└── *.md                       # Specification documents
```

## Key Patterns

### AG-UI Protocol
- Agent tools return "signals", not direct state mutations
- Server intercepts tool results and generates `STATE_DELTA` events (JSON Patches)
- Frontend applies patches via `fast-json-patch` library
- Events stream via SSE: `RUN_STARTED` → `STATE_SNAPSHOT` → `TOOL_CALL_*` → `STATE_DELTA` → `TEXT_MESSAGE_CONTENT` → `RUN_FINISHED`

### State Management
- Zustand store in `frontend/src/store/usePlannerStore.ts`
- State shape defined in `project-planning-agent/schema.py` (Python) and `frontend/src/store/types.ts` (TypeScript)
- Keep both in sync when modifying the schema

### Thread Isolation
- Each session has a `thread_id` (stored in localStorage)
- Backend maintains per-thread state in `_state_store` and history in `_history_store`
- Thread ID shared between chat and voice modes

### Task Types
- `fixed` - Calendar events, cannot be moved by agent
- `flexible` - User/email tasks, can be moved between days

## Running the Project

### Backend
```bash
cd project-planning-agent
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Voice Agent (optional)
```bash
cd livekit-adaptor
pip install -r requirements.txt
python agent.py
```

## Common Tasks

### Adding a New Tool
1. Define tool in `project-planning-agent/tools/actions.py`
2. Add to agent's tool list in `agent_logic.py`
3. If it modifies state, add interceptor logic in `server.py` to generate STATE_DELTA

### Modifying State Schema
1. Update Pydantic models in `project-planning-agent/schema.py`
2. Update TypeScript types in `frontend/src/store/types.ts`
3. Update Zustand store if needed in `usePlannerStore.ts`

### Adding UI Components
- Components live in `frontend/src/components/`
- Use Tailwind CSS for styling
- Access state via `usePlannerStore()` hook

### Testing Agent Changes
- Send messages via the chat UI or use curl:
```bash
curl -X POST http://localhost:8000/agent \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "test", "messages": [{"role": "user", "content": "What is on my calendar today?"}]}'
```

## Important Files

| File | Purpose |
|------|---------|
| `server.py` | AG-UI protocol translation, SSE streaming, state management |
| `agent_logic.py` | LangChain agent setup and system prompt |
| `schema.py` | Pydantic models (source of truth for state shape) |
| `useAgUiPlanner.ts` | Frontend agent connection and event handling |
| `usePlannerStore.ts` | Zustand store with `applyDelta()` for JSON patches |
| `useVoiceMode.ts` | LiveKit room connection and voice handling |

## Gotchas

1. **JSON Patches** - STATE_DELTA uses RFC 6902 patches. Paths are like `/columns/today/tasks/0`
2. **Fixed vs Flexible** - Never let the agent move `type: "fixed"` tasks
3. **Optimistic Updates** - Drag-and-drop updates UI immediately; agent may revert via STATE_DELTA
4. **SSE Streaming** - Backend uses `text/event-stream`; handle connection drops gracefully
5. **Thread ID** - Must be consistent between chat and voice for history continuity

## Tech Stack

**Backend:** Python 3.11+, FastAPI, LangChain v1, Pydantic v2, uvicorn

**Frontend:** React 19, TypeScript, Vite, Zustand, Tailwind CSS, dnd-kit, fast-json-patch, @ag-ui/client

**Voice:** LiveKit Agents SDK, AssemblyAI (STT), Cartesia (TTS)

## Specification Documents

- `agent-spec.md` - Complete agent architecture
- `voice-chat-state-sync-spec.md` - Bidirectional sync between voice and chat
- `UIspec.md` - UI/UX specifications
- `Schema-def.md` - Data schema definitions
- `agents.md` - Agent documentation
