---
name: Voice-Chat State Sync
overview: Implement bidirectional state and history synchronization between voice (LiveKit) and text chat (AG-UI) channels as defined in voice-chat-state-sync-spec.md. This ensures seamless context continuity when users switch between input modes.
todos:
  - id: frontend-thread-hook
    content: Create useThreadId.ts hook with localStorage persistence
    status: completed
  - id: frontend-agui-planner
    content: Update useAgUiPlanner.ts to use shared thread_id
    status: completed
  - id: frontend-voice-mode
    content: "Update useVoiceMode.ts: pass thread_id, subscribe to RoomMetadataChanged"
    status: completed
  - id: backend-history-storage
    content: Add _history_store and GET /agent/history endpoint to server.py
    status: completed
  - id: backend-save-history
    content: Update stream_agent_events to persist messages to _history_store
    status: completed
  - id: token-server-thread-id
    content: Update token_server.py to accept and store thread_id in token metadata
    status: completed
  - id: livekit-agent-refactor
    content: "Refactor agent.py: store room/thread_id, fetch history, parse state deltas, update room metadata"
    status: completed
---

# Voice-Chat Bidirectional State Synchronization

Implement the architecture from [voice-chat-state-sync-spec.md](voice-chat-state-sync-spec.md) to enable:

- Shared `thread_id` across voice and chat
- Backend-managed conversation history persistence
- State updates pushed via LiveKit room metadata
```mermaid
flowchart LR
    subgraph frontend [Frontend]
        ThreadHook[useThreadId]
        Chat[useAgUiPlanner]
        Voice[useVoiceMode]
        Store[Zustand Store]
    end
    
    subgraph backend [Backend]
        Server[FastAPI /agent]
        StateStore[_state_store]
        HistStore[_history_store]
    end
    
    subgraph livekit [LiveKit]
        Agent[LiveKit Agent]
        RoomMeta[Room Metadata]
    end
    
    ThreadHook --> Chat
    ThreadHook --> Voice
    Chat -->|POST /agent| Server
    Chat -->|SSE events| Store
    Voice -->|WebRTC + thread_id| Agent
    Agent -->|GET /agent/history| HistStore
    Agent -->|POST /agent| Server
    Agent -->|update_room_metadata| RoomMeta
    RoomMeta -->|RoomMetadataChanged| Store
    Server --> StateStore
    Server --> HistStore
```


## Implementation

### 1. Frontend: Thread ID Hook

Create [frontend/src/hooks/useThreadId.ts](frontend/src/hooks/useThreadId.ts) - stores stable `thread_id` in localStorage, shared by both channels.

### 2. Frontend: Update useAgUiPlanner

Modify [frontend/src/hooks/useAgUiPlanner.ts](frontend/src/hooks/useAgUiPlanner.ts):

- Import and use `useThreadId()` instead of `crypto.randomUUID()`

### 3. Frontend: Update useVoiceMode

Modify [frontend/src/hooks/useVoiceMode.ts](frontend/src/hooks/useVoiceMode.ts):

- Pass `thread_id` to token server
- Subscribe to `RoomEvent.RoomMetadataChanged`
- Update Zustand store when metadata changes

### 4. Backend: History Storage

Modify [project-planning-agent/server.py](project-planning-agent/server.py):

- Add `_history_store: Dict[str, List[Dict]]`
- Add `GET /agent/history/{thread_id}` endpoint
- Update `stream_agent_events` to save messages to `_history_store`

### 5. Token Server: Accept thread_id

Modify [livekit-adaptor/token_server.py](livekit-adaptor/token_server.py):

- Accept `thread_id` query parameter
- Store in token metadata as JSON

### 6. LiveKit Agent: Major Refactor

Modify [livekit-adaptor/agent.py](livekit-adaptor/agent.py):

- Update `PlannerAgent` to store `_room`, `_thread_id`, `_conversation_history`
- Fetch history from backend in entrypoint before session starts
- Rewrite `query_planner` to:
  - Fetch current state via `GET /agent/state/{thread_id}`
  - Send stored history + query to `POST /agent`
  - Parse `STATE_DELTA` / `STATE_SNAPSHOT` from response
  - Update room metadata via `api.LiveKitAPI().room.update_room_metadata()`
- Add `jsonpatch` to requirements for delta application

### Dependencies

- Add `jsonpatch` to [livekit-adaptor/requirements.txt](livekit-adaptor/requirements.txt)