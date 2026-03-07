# Voice-Chat Bidirectional State Synchronization Spec

## Overview

This spec defines how state and conversation history synchronization works bidirectionally between the **voice channel** (LiveKit) and **text chat channel** (AG-UI HTTP), ensuring that:

1. **Thread ID Consistency**: Both channels use the same `thread_id` for session continuity
2. **State Persistence**: PlannerState updates from voice carry forward to chat (and vice versa)
3. **Conversation History Continuity**: Chat history is available in voice mode and vice versa
4. **Real-time UI Updates**: Frontend receives state updates via LiveKit room metadata (voice) and AG-UI SSE events (chat)
5. **Unified State Store**: Both channels update the same Zustand store

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                                   │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Zustand Store (Single Source of Truth)          │   │
│  │  - PlannerState plan                                                │   │
│  │  - ChatMessage[] messages                                           │   │
│  │  - thread_id (from useThreadId hook)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↑                      ↑                        │
│              ┌───────────────┘                      └───────────────┐       │
│              │                                                     │       │
│   ┌──────────────────────┐                         ┌──────────────────────┐│
│   │  useAgUiPlanner      │                         │  useVoiceMode        ││
│   │  (Text Chat)         │                         │  (Voice)             ││
│   │  - HTTP POST /agent  │                         │  - WebRTC Audio      ││
│   │  - SSE Events        │                         │  - RoomMetadataChgd  ││
│   └──────────────────────┘                         └──────────────────────┘│
└──────────────┼─────────────────────────────────────────────────────┼───────┘
               │ HTTP + SSE                                          │ WebRTC
┌──────────────┼─────────────────────────────────────────────────────┼───────┐
│              ↓                                                     ↓       │
│  ┌──────────────────────┐                         ┌──────────────────────┐│
│  │  AG-UI Backend       │                         │  LiveKit Server      ││
│  │  (FastAPI)           │                         │  (WebRTC SFU)        ││
│  │                      │◄────────────────────────│                      ││
│  │  - /agent (POST)     │     HTTP calls from     │  - Room Metadata     ││
│  │  - /agent/state/{id} │     LiveKit Agent       │  - Broadcasts events ││
│  │  - /agent/history/{} │                         │                      ││
│  │  - State + History   │                         │                      ││
│  │    Storage           │                         │                      ││
│  └──────────────────────┘                         └──────────────────────┘│
│              ↑                                                     ↑       │
│              │ HTTP                                                │       │
│  ┌───────────┴─────────────────────────────────────────────────────┴──────┐│
│  │                    LiveKit Agent (Python Worker)                       ││
│  │                                                                        ││
│  │  1. On session start: GET /agent/history/{thread_id}                  ││
│  │  2. On user query: POST /agent (with history + state)                 ││
│  │  3. Parse response: Extract STATE_DELTA, update room metadata         ││
│  └────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### 1. Thread ID Consistency

**Rule**: Both voice and chat channels MUST use the same `thread_id` for the same user session.

**Current Problem**:
- **Voice Channel**: Uses `thread_id = f"voice-{room_name}"` (e.g., `"voice-planner-room"`)
- **Chat Channel**: Uses `thread_id = random UUID` (generated once per browser session)

These don't match, so state and history are stored separately.

**Solution**: Frontend generates a **stable thread_id** stored in localStorage, used by both channels.

**Room Name Flow** (for reference):
1. Frontend (`useVoiceMode.ts:40`): Hardcoded `const room = 'planner-room'`
2. Token Server (`token_server.py:35`): Accepts room param, default `"planner-room"`
3. LiveKit Agent: Gets room name from `ctx.room.name` in entrypoint

---

### 2. Conversation History Continuity

**Problem**: `context.session.history` (LiveKit AgentSession) only contains messages from the **current voice session**. It has no knowledge of previous chat messages.

**Solution**: Backend stores conversation history per `thread_id`. Voice agent fetches this history when session starts.

**New Backend Endpoint**:
```
GET /agent/history/{thread_id}
Returns: { "messages": [...], "thread_id": "..." }

POST /agent/history/{thread_id}  (optional, for explicit saves)
Body: { "messages": [...] }
```

**History Flow**:
```
Chat → Voice Transition:
1. Chat messages stored in backend via POST /agent (backend saves to _history_store)
2. User switches to voice
3. Voice agent starts → GET /agent/history/{thread_id}
4. Agent receives full chat history
5. Agent includes this history in POST /agent calls
6. Backend merges/updates stored history

Voice → Chat Transition:
1. Voice agent sends history with each POST /agent
2. Backend stores updated history in _history_store
3. User switches to chat
4. Chat (via Zustand) already has messages from SSE events
5. Chat sends messages to POST /agent
6. Backend merges with stored history
```

---

### 3. State Flow via Room Metadata

Voice channel uses LiveKit room metadata to push state updates to frontend:

```
User speaks: "Add task X"
  ↓
LiveKit Agent: GET /agent/state/{thread_id} → Current PlannerState
  ↓
LiveKit Agent: POST /agent (with history + state)
  ↓
Backend: Processes, emits STATE_DELTA in SSE stream
  ↓
LiveKit Agent: Parses STATE_DELTA, applies to current state
  ↓
LiveKit Agent: Updates room metadata via LiveKit API
  ↓
LiveKit Server: Broadcasts RoomMetadataChanged event
  ↓
Frontend: Receives event → store.setFullState(state)
  ↓
UI: Re-renders with updated PlannerState
```

---

## Implementation Details

### 1. Frontend Changes

#### A. Thread ID Hook (`frontend/src/hooks/useThreadId.ts`)

**New file** - manages consistent thread_id across channels:

```typescript
import { useRef } from 'react';

const THREAD_ID_KEY = 'planner_thread_id';

export function useThreadId(): string {
  const threadIdRef = useRef<string | null>(null);
  
  if (!threadIdRef.current) {
    const stored = localStorage.getItem(THREAD_ID_KEY);
    if (stored) {
      threadIdRef.current = stored;
    } else {
      threadIdRef.current = crypto.randomUUID();
      localStorage.setItem(THREAD_ID_KEY, threadIdRef.current);
    }
  }
  
  return threadIdRef.current;
}

// Optional: Function to reset thread_id (new conversation)
export function resetThreadId(): string {
  const newId = crypto.randomUUID();
  localStorage.setItem(THREAD_ID_KEY, newId);
  return newId;
}
```

#### B. Update `useAgUiPlanner.ts`

Use `useThreadId()` instead of random UUID:

```typescript
import { useThreadId } from './useThreadId';

export function useAgUiPlanner() {
  const store = usePlannerStore();
  const threadId = useThreadId(); // Stable thread_id
  
  const agentRef = useRef<HttpAgent | null>(null);
  
  const getAgent = () => {
    if (!agentRef.current) {
      agentRef.current = new HttpAgent({
        url: AGENT_URL,
        threadId: threadId,
        initialState: store.plan
      });
    }
    return agentRef.current;
  };
  // ... rest unchanged
}
```

#### C. Update `useVoiceMode.ts`

Add thread_id to token request and RoomMetadataChanged subscription:

```typescript
import { useThreadId } from './useThreadId';
import type { PlannerState } from '../store/types';

export function useVoiceMode() {
  const store = usePlannerStore();
  const threadId = useThreadId();
  const roomRef = useRef<Room | null>(null);

  const connect = useCallback(async () => {
    // ... existing setup code ...
    
    // Pass thread_id to token server
    const tokenResponse = await fetch(
      `${TOKEN_URL}?identity=${identity}&room=${room}&thread_id=${threadId}`
    );
    
    // ... create livekitRoom ...
    
    // Subscribe to RoomMetadataChanged for state updates
    livekitRoom.on(RoomEvent.RoomMetadataChanged, (metadata: string | undefined) => {
      if (metadata) {
        try {
          const parsed = JSON.parse(metadata);
          if (parsed.planner_state) {
            store.setFullState(parsed.planner_state as PlannerState);
          }
        } catch (error) {
          console.error('Failed to parse room metadata:', error);
        }
      }
    });
    
    // ... rest of connect code ...
  }, [store, threadId]);
  
  // ... rest unchanged
}
```

---

### 2. Backend Changes (`project-planning-agent/server.py`)

#### A. Add History Storage

```python
# Add alongside existing state storage
_history_store: Dict[str, List[Dict[str, Any]]] = {}

def get_history(thread_id: str) -> List[Dict[str, Any]]:
    """Get conversation history for a thread."""
    return _history_store.get(thread_id, [])

def update_history(thread_id: str, messages: List[Dict[str, Any]]):
    """Update conversation history for a thread."""
    _history_store[thread_id] = messages
```

#### B. Add History Endpoint

```python
@app.get("/agent/history/{thread_id}")
async def get_conversation_history(thread_id: str):
    """
    Get conversation history for a thread.
    Used by voice agent to fetch previous chat history.
    """
    history = get_history(thread_id)
    return {
        "thread_id": thread_id,
        "messages": history
    }
```

#### C. Update `/agent` Endpoint to Save History

In `stream_agent_events`, after processing:

```python
# Save updated messages to history store
all_messages = [
    {"id": m.id, "role": m.role, "content": m.content}
    for m in input_data.messages
]
# Add assistant response
if assistant_response:
    all_messages.append({
        "id": str(uuid.uuid4()),
        "role": "assistant", 
        "content": assistant_response
    })
update_history(input_data.thread_id, all_messages)
```

---

### 3. LiveKit Agent Changes (`livekit-adaptor/agent.py`)

#### A. Store Room Reference in Agent

```python
from livekit import rtc, api
from livekit.api import UpdateRoomMetadataRequest

class PlannerAgent(Agent):
    def __init__(self, room: rtc.Room, thread_id: str):
        super().__init__(
            instructions=AGENT_INSTRUCTIONS,
            tools=[self.query_planner]
        )
        self._room = room
        self._thread_id = thread_id
        self._conversation_history: List[Dict] = []
```

#### B. Fetch History on Session Start

```python
@server.rtc_session()
async def voice_agent_session(ctx: JobContext):
    """Entry point for LiveKit agent sessions."""
    
    # Get thread_id from room metadata (set by token server)
    thread_id = "unknown"
    if ctx.room.metadata:
        try:
            metadata = json.loads(ctx.room.metadata)
            thread_id = metadata.get("thread_id", f"voice-{ctx.room.name}")
        except:
            thread_id = f"voice-{ctx.room.name}"
    
    logger.info(f"Voice session started - Room: {ctx.room.name}, Thread: {thread_id}")
    
    # Fetch existing conversation history from backend
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{AGUI_BACKEND_URL}/agent/history/{thread_id}")
            if response.status_code == 200:
                data = response.json()
                history = data.get("messages", [])
                logger.info(f"Fetched {len(history)} messages from backend history")
            else:
                history = []
        except Exception as e:
            logger.warning(f"Failed to fetch history: {e}")
            history = []
    
    # Create agent with room reference and history
    agent = PlannerAgent(room=ctx.room, thread_id=thread_id)
    agent._conversation_history = history
    
    # Start session
    session = AgentSession(
        llm=openai.LLM(model="gpt-4o-mini"),
        stt=openai.STT(),
        tts=openai.TTS(),
        vad=silero.VAD.load(),
    )
    
    await session.start(agent=agent, room=ctx.room)
```

#### C. Update `query_planner` Tool

```python
@function_tool()
async def query_planner(
    self,
    context: RunContext,
    user_query: str,
) -> str:
    """Query the planner backend with conversation history and current state."""
    
    logger.info(f"Querying planner backend: {user_query}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Get current PlannerState
        current_state = await self._fetch_current_state(client)
        
        # Step 2: Build messages from stored history + current query
        messages = list(self._conversation_history)  # Copy existing history
        
        # Add current user query if not already in history
        if not messages or messages[-1].get("content") != user_query:
            messages.append({
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": user_query
            })
        
        # Step 3: POST to backend
        payload = {
            "thread_id": self._thread_id,
            "run_id": str(uuid.uuid4()),
            "messages": messages,
            "state": current_state,
            "tools": [],
            "context": [],
            "forwarded_props": None
        }
        
        logger.info(f"Sending {len(messages)} messages to backend")
        
        try:
            async with client.stream(
                "POST",
                f"{AGUI_BACKEND_URL}/agent",
                json=payload,
                headers={"Accept": "text/event-stream"}
            ) as response:
                response.raise_for_status()
                
                text_response = ""
                state_deltas = []
                final_state = current_state.copy() if current_state else {}
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            
                            if data.get("type") == "TEXT_MESSAGE_CONTENT":
                                text_response += data.get("delta", "")
                            
                            elif data.get("type") == "STATE_DELTA":
                                delta = data.get("delta")
                                state_deltas.append(delta)
                                # Apply delta to final_state
                                final_state = self._apply_delta(final_state, delta)
                            
                            elif data.get("type") == "STATE_SNAPSHOT":
                                final_state = data.get("snapshot", {})
                                
                        except json.JSONDecodeError:
                            continue
                
                # Step 4: Update room metadata with final state
                if state_deltas or final_state:
                    await self._update_room_metadata(final_state)
                
                # Step 5: Update local history
                if text_response:
                    messages.append({
                        "id": str(uuid.uuid4()),
                        "role": "assistant",
                        "content": text_response
                    })
                    self._conversation_history = messages
                
                return text_response if text_response else "I've updated your planner."
                
        except Exception as e:
            logger.error(f"Error querying backend: {e}", exc_info=True)
            return "Sorry, I encountered an error."

async def _fetch_current_state(self, client: httpx.AsyncClient) -> dict:
    """Fetch current PlannerState from backend."""
    try:
        async with client.stream(
            "GET",
            f"{AGUI_BACKEND_URL}/agent/state/{self._thread_id}",
            headers={"Accept": "text/event-stream"}
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    if data.get("type") == "STATE_SNAPSHOT":
                        return data.get("snapshot", {})
    except Exception as e:
        logger.warning(f"Failed to fetch state: {e}")
    
    return {"visual_tone": "neutral", "columns": {"today": {"tasks": []}, "tomorrow": {"tasks": []}, "next": {"tasks": []}}}

def _apply_delta(self, state: dict, delta: dict) -> dict:
    """Apply a JSON Patch delta to state."""
    import jsonpatch
    if delta.get("op") == "replace" and delta.get("path") == "":
        return delta.get("value", state)
    return jsonpatch.apply_patch(state, [delta])

async def _update_room_metadata(self, state: dict):
    """Update LiveKit room metadata with PlannerState."""
    try:
        metadata = json.dumps({
            "thread_id": self._thread_id,
            "planner_state": state
        })
        
        # Use LiveKit API to update room metadata
        lk_api = api.LiveKitAPI()  # Reads env vars: LIVEKIT_URL, API_KEY, API_SECRET
        await lk_api.room.update_room_metadata(
            UpdateRoomMetadataRequest(
                room=self._room.name,
                metadata=metadata
            )
        )
        
        logger.info(f"Updated room metadata with PlannerState")
        
    except Exception as e:
        logger.error(f"Failed to update room metadata: {e}", exc_info=True)
```

---

### 4. Token Server Changes (`livekit-adaptor/token_server.py`)

Store thread_id in room metadata when creating token:

```python
@app.get("/livekit/token")
async def get_livekit_token(
    identity: str,
    room: str = "planner-room",
    thread_id: str = None
):
    """Generate LiveKit access token with thread_id in metadata."""
    
    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    token.identity = identity
    token.name = f"User {identity}"
    
    # Store thread_id in participant metadata
    if thread_id:
        token.metadata = json.dumps({"thread_id": thread_id})
    
    token.add_grant(api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    ))
    
    # Also set initial room metadata if we have thread_id
    # Note: Room metadata is typically set by the first participant or via API
    
    return {
        "token": token.to_jwt(),
        "url": LIVEKIT_URL,
        "room": room,
        "thread_id": thread_id
    }
```

---

## Data Flow Summary

### Chat → Voice Transition

```
1. User chats via text
   - Messages sent to POST /agent
   - Backend saves messages to _history_store[thread_id]
   - State saved to _state_store[thread_id]
   
2. User clicks voice mode
   - Frontend passes thread_id to token server
   - Thread_id stored in token metadata
   
3. Voice agent starts
   - Gets thread_id from room/participant metadata
   - Fetches history: GET /agent/history/{thread_id}
   - Has full chat history!
   
4. User speaks
   - Agent includes fetched history + new query in POST /agent
   - Continuity maintained
```

### Voice → Chat Transition

```
1. User interacts via voice
   - Agent sends history with each POST /agent
   - Backend updates _history_store[thread_id]
   - State updates pushed via room metadata
   - Frontend Zustand store updated via RoomMetadataChanged
   
2. User switches to chat
   - Chat hook uses same thread_id
   - Zustand store already has current state
   - User sends chat message
   - POST /agent with Zustand messages + state
   - Backend merges with stored history
```

---

## Testing Checklist

### Thread ID Consistency
- [ ] Frontend generates stable thread_id in localStorage
- [ ] Both useAgUiPlanner and useVoiceMode use same thread_id
- [ ] Thread_id passed to token server
- [ ] LiveKit agent receives thread_id

### History Persistence
- [ ] Backend stores messages in _history_store
- [ ] GET /agent/history/{thread_id} returns correct messages
- [ ] Voice agent fetches history on session start
- [ ] Chat history available in voice mode
- [ ] Voice history preserved when switching to chat

### State Synchronization  
- [ ] Agent fetches current state before POST
- [ ] STATE_DELTA events parsed correctly
- [ ] Room metadata updated with final state
- [ ] Frontend receives RoomMetadataChanged
- [ ] Zustand store updates via setFullState

### Channel Switching
- [ ] Chat → Voice: History carries over
- [ ] Voice → Chat: State and history preserved
- [ ] Multiple switches work correctly

---

## API Reference

### Validated LiveKit APIs

| API | Package | Usage |
|-----|---------|-------|
| `RoomEvent.RoomMetadataChanged` | `livekit-client` (JS) | Frontend subscribes to state changes |
| `room.on("room_metadata_changed", ...)` | `livekit-rtc` (Python) | Agent subscribes to metadata changes |
| `api.LiveKitAPI().room.update_room_metadata(UpdateRoomMetadataRequest(...))` | `livekit-api` (Python) | Agent updates room metadata |
| `ctx.room` | `livekit.agents` (Python) | Access room in entrypoint |
| `session.history` | `livekit.agents` (Python) | Voice session history (local only) |

### Backend Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agent` | POST | Process user message, return SSE events |
| `/agent/state/{thread_id}` | GET | Get current PlannerState |
| `/agent/history/{thread_id}` | GET | Get conversation history |

---

## Notes

- **State Source of Truth**: Backend `_state_store` is authoritative
- **History Source of Truth**: Backend `_history_store` is authoritative  
- **UI Source of Truth**: Zustand store for rendering
- **Room Metadata Limit**: 64 KiB max (PlannerState JSON must fit)
- **History Limit**: Consider pagination for very long conversations
