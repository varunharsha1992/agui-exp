Here is a comprehensive CURSOR_CONTEXT.md file. You should place this in the root of your monorepo.

When you open this project in Cursor, drag and drop this file into your chat (or reference it via @CURSOR_CONTEXT.md) whenever you start a new session. It provides the AI with the complete architectural blueprint so it doesn't "hallucinate" a different stack.

Project Context: Rolling 3-Day AI Planner (AG-UI MVP)
1. Product Vision
We are building a Rolling 3-Day Planner—a collaborative productivity tool where an AI agent helps a user manage their schedule. The core innovation is the AG-UI (Agent-User Interaction) Protocol: instead of the agent returning just text, it maintains a live "Shared State" with the UI, sending incremental updates (deltas) to move tasks, change visual tones, and rebalance workloads.

Key Features
Split Interface: Left panel for free-form Chat; Right panel for the 3-Day Kanban board (Today / Tomorrow / Next).

Shared State: The Agent and User manipulate the exact same data structure.

Visual Tone: The UI changes "vibe" (Calm/Neutral/Tight) based on the Agent's assessment of the schedule load.

Simulated Backend: We use mock JSON files for Calendar and Email data to simulate a real environment.

2. Monorepo Structure
The project follows a strict monorepo structure separating the "Dumb Renderer" (Frontend) from the "Smart State Manager" (Agent).

Plaintext

/
├── agent/                  # Backend: Python + FastAPI + LangChain v1
│   ├── server.py           # Main FastAPI entrypoint (AG-UI Wrapper)
│   ├── agent_logic.py      # LangChain v1 Agent Definition
│   ├── schema.py           # Shared State Pydantic Models
│   ├── tools/              # Agent Capabilities
│   │   ├── __init__.py
│   │   ├── calendar.py     # Mock Calendar reader
│   │   ├── email.py        # Mock Email reader
│   │   └── actions.py      # "Move Task" tools (State Modifiers)
│   └── data/               # Mock Data Sources
│       ├── mock_calendar.json
│       └── mock_email.json
│
├── frontend/               # Frontend: React + Vite
│   ├── src/
│   │   ├── store/          # Zustand State Store
│   │   │   ├── usePlannerStore.ts
│   │   │   └── types.ts    # TypeScript definitions of State
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── Board.tsx
│   │   │   └── TaskCard.tsx
│   │   └── hooks/
│   │       └── useAgUi.ts  # Custom hook wrapping @ag-ui/client
│   └── package.json
│
└── CURSOR_CONTEXT.md       # This file
3. The AG-UI Protocol (Architecture)
This is NOT a standard REST API. It is an Event Stream.

The Shared State Schema
The "Source of Truth" is this JSON structure. The Agent emits patches to modify it; the UI renders it.

TypeScript

interface PlannerState {
  globalTone: 'calm' | 'neutral' | 'tight'; // Controls CSS theme
  columns: {
    today: Column;
    tomorrow: Column;
    next: Column;
  };
}

interface Column {
  id: string;
  tasks: Task[]; // Stack of task objects
  loadLevel: 'light' | 'medium' | 'heavy';
}
The Event Stream
The backend streams these specific AG-UI events:

RUN_STARTED: Session begins.

STATE_SNAPSHOT: Initial full load of the 3-day plan.

TEXT_MESSAGE_CHUNK: Streaming chat tokens ("I moved your meeting...").

TOOL_CALL_START / ARGS / RESULT: Visualizes the agent "thinking" (e.g., "Checking Calendar...").

STATE_DELTA: Critical. JSON Patches (RFC 6902) that modify the UI state.

Example: [{ "op": "move", "from": "/columns/today/tasks/0", "path": "/columns/tomorrow/tasks/-" }]

4. Backend Implementation Specs (/agent)
Stack

Framework: FastAPI 


LLM Orchestration: LangChain v1 (create_agent) 

Protocol: ag-ui-protocol (Python SDK)

Logic Flow (server.py)
The server wrapper acts as a Translation Layer between LangChain and AG-UI.

Ingest: Receive RunAgentInput (User Message).

Execute: Run agent_executor.stream().

Intercept & Translate:

If Agent streams text → Emit TEXT_MESSAGE_CHUNK.

If Agent calls fetch_calendar → Emit TOOL_CALL events (Visual only).

Crucial: If Agent calls move_task_in_plan → Intercept the result. Do not just output text. Construct a JSON Patch representing that move and emit a STATE_DELTA event.

The "Simulated" Tools
Read Tools: fetch_calendar, fetch_emails. Return JSON from data/.

Write Tools: move_task_in_plan(task_id, target_col). The agent calls this to "act." The server uses this intent to generate the STATE_DELTA.

5. Frontend Implementation Specs (/frontend)
Stack
Framework: React + Vite

State: Zustand (for the Shared State)


Protocol Client: @ag-ui/client (HttpAgent) 

Patching: fast-json-patch

Drag & Drop: dnd-kit

Core Logic (useAgUi.ts & Store)
Dumb Rendering: The UI components (Board, Column) never calculate state. They simply render what is in the Zustand store.

Patch Application: When a STATE_DELTA event arrives, use applyPatch (from fast-json-patch) to mutate the Zustand store.

Optimistic UI:

When the user drags a task (via dnd-kit), update the Zustand store immediately (Optimistic Update).

Send a background message to the Agent: "User moved task X to Tomorrow."

If the Agent disagrees (e.g., "That overlaps with a meeting"), the Agent will emit a STATE_DELTA moving it back, plus a TEXT_MESSAGE explaining why.

6. Implementation Checklist
Phase 1: Backend "Brain"
[ ] Create schema.py (Pydantic models for the State).

[ ] Create mock_calendar.json & mock_email.json.

[ ] Implement LangChain v1 Agent with create_agent and the @tool definitions.

[ ] Implement server.py with the Event Encoder loop to map LangChain chunks to AG-UI events.

Phase 2: Frontend "Body"
[ ] Scaffold React + Zustand.

[ ] Create the Split-Screen Layout (Chat Left, Board Right).

[ ] Implement usePlannerStore with applyDelta action.

[ ] Wire up HttpAgent to localhost:8000.

Phase 3: The Loop
[ ] Verify that asking "Move the report to tomorrow" triggers a visible card movement without page reload.

[ ] Verify that dragging a card triggers an Agent acknowledgement.