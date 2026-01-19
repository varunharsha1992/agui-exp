# LiveKit Voice Agent Spec

## Role
The **Voice Adapter** - a simple intermediary between user speech and the existing AG-UI backend.

## Goal
Keep voice and chat as separate input channels, both calling the **same** LangChain agent backend. The voice agent does NOT contain planning logic - it simply:
1. Converts speech to text
2. Calls the existing HTTP agent
3. Converts the text response to speech

---

## Simple Flow

```
User speaks → [LiveKit Agent] → STT → Text
                                  ↓
                     HTTP POST to /agent
                                  ↓
                   Text response from LangChain
                                  ↓
             TTS → [LiveKit Agent] → User hears
```

**No hybrid UI sync needed for POC** - the voice response is self-contained.

---

## Architecture

### Service Separation

LiveKit agents are **worker processes** (not HTTP servers). They connect to LiveKit Cloud and get assigned to rooms. This requires a separate service from the existing AG-UI backend.

```
┌─────────────────┐         ┌─────────────────────┐         ┌─────────────────┐
│   Frontend      │  Audio  │  livekit-adaptor/   │  HTTP   │ project-planning│
│   (React)       │◄───────►│     agent.py        │────────►│  -agent/server  │
│                 │ WebRTC  │   (LiveKit Worker)  │  POST   │     .py         │
└─────────────────┘         └─────────────────────┘         └─────────────────┘
       │                            │                              │
       │                     Token  │                              │
       │                    Request │                              │
       │                            ▼                              │
       │                    /livekit/token                         │
       │                                                           │
       │                      HTTP (text chat)                     │
       └───────────────────────────────────────────────────────────┘
```

### Folder Structure

```
agui-exp/
├── project-planning-agent/     # EXISTING - unchanged
│   ├── server.py               # AG-UI backend (FastAPI, port 8000)
│   ├── agent_logic.py
│   ├── schema.py
│   └── ...
│
├── livekit-adaptor/            # NEW - separate service
│   ├── agent.py                # LiveKit worker process
│   ├── token_server.py         # Simple FastAPI for /livekit/token
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/                   # EXISTING - add voice mode
    └── ...
```

### What's Shared
- Same `/agent` HTTP endpoint (called by both chat UI and voice adaptor)
- Same LangChain agent logic
- Same tools (calendar, email, task actions)

### What's Separate
- `livekit-adaptor/` is its own deployable service
- Voice uses LiveKit rooms for audio transport
- Text uses direct HTTP + SSE to `project-planning-agent`

---

## livekit-adaptor/ Service

### Components

| File | Purpose |
|------|---------|
| `agent.py` | LiveKit worker - handles STT/TTS, calls backend |
| `token_server.py` | Tiny FastAPI server for `/livekit/token` endpoint |
| `requirements.txt` | LiveKit packages + httpx |
| `.env.example` | Required environment variables |

### agent.py Concept

Use LiveKit's **AgentSession** with a **function tool** that calls the existing backend:

```
AgentSession(
    stt = "deepgram" or "openai",
    llm = minimal (just routes to tool),
    tts = "openai" or "cartesia",
    vad = silero.VAD,
    tools = [call_planner_backend]
)
```

The `call_planner_backend` tool:
1. Receives user's transcribed text
2. Makes HTTP POST to `http://localhost:8000/agent`
3. Parses SSE stream, extracts text response
4. Returns text to be spoken

### token_server.py Concept

Simple FastAPI app (can run on port 8001):

```python
@app.get("/livekit/token")
async def get_token(identity: str, room: str = "planner-room"):
    # Generate JWT using livekit-api
    # Return: {"token": "...", "url": LIVEKIT_URL}
```

---

## Running the Services

### Development (3 terminals)

```bash
# Terminal 1: AG-UI Backend
cd project-planning-agent
python server.py
# Runs on http://localhost:8000

# Terminal 2: LiveKit Token Server
cd livekit-adaptor
python token_server.py
# Runs on http://localhost:8001

# Terminal 3: LiveKit Agent Worker
cd livekit-adaptor
python agent.py dev
# Connects to LiveKit Cloud, waits for room assignments
```

### Frontend Points To

| Endpoint | Service |
|----------|---------|
| `/agent` (text chat) | `http://localhost:8000` |
| `/livekit/token` | `http://localhost:8001` |
| LiveKit WebRTC | `wss://your-project.livekit.cloud` |

---

## LiveKit Agent Implementation

### Key LiveKit Concepts

| Concept | Description |
|---------|-------------|
| **Room** | Virtual space where user and agent meet |
| **AgentSession** | Orchestrates STT → LLM → TTS pipeline |
| **VAD (Silero)** | Voice Activity Detection - knows when user stops talking |
| **STT** | Speech-to-Text (Deepgram/OpenAI Whisper) |
| **TTS** | Text-to-Speech (OpenAI/Cartesia) |
| **@function_tool** | Custom function the agent can call |

### Calling the Existing Backend

The agent makes HTTP POST to the existing `/agent` endpoint:

```json
{
  "thread_id": "voice-session-123",
  "run_id": "uuid",
  "messages": [
    {"id": "1", "role": "user", "content": "Show me my schedule"}
  ],
  "state": null,
  "tools": [],
  "context": []
}
```

### Parsing the SSE Response

The backend streams AG-UI events. For voice, we only need:
- `TEXT_MESSAGE_CONTENT` events → concatenate the `delta` fields
- Ignore `STATE_DELTA`, `TOOL_CALL_*` etc (no visual UI to update)

---

## Room Setup

### How Rooms Work
1. **User requests token** from `livekit-adaptor` (`/livekit/token`)
2. **User connects** to room with the token
3. **Agent auto-dispatches** when user joins (via LiveKit Cloud config)
4. **Audio flows** bidirectionally via WebRTC

### Agent Dispatch Options
1. **Auto-dispatch**: Configure in LiveKit Cloud dashboard
2. **Explicit dispatch**: Include agent config in the token

For POC, use auto-dispatch - simpler setup.

---

## Dependencies

### livekit-adaptor/requirements.txt
```
livekit-agents>=1.0
livekit-plugins-openai
livekit-plugins-silero
livekit-api
httpx
fastapi
uvicorn
python-dotenv
```

### livekit-adaptor/.env.example
```
# LiveKit Cloud
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# AG-UI Backend (the existing server)
AGUI_BACKEND_URL=http://localhost:8000

# Token server port
TOKEN_SERVER_PORT=8001
```

---

## What NOT to Build (POC Scope)

- ❌ Visual board updates during voice (no data packets)
- ❌ Simultaneous voice + text
- ❌ Voice transcription display in chat
- ❌ Interrupt handling (let agent finish speaking)
- ❌ Complex latency masking ("thinking" sounds)

---

## Testing Checklist

1. [ ] AG-UI Backend running on :8000
2. [ ] Token server running on :8001
3. [ ] LiveKit agent connected to LiveKit Cloud
4. [ ] `/livekit/token` returns valid JWT
5. [ ] Agent joins room when user connects
6. [ ] STT transcribes user speech correctly
7. [ ] HTTP call to `/agent` succeeds
8. [ ] TTS speaks the response
9. [ ] End-to-end: "Show me my schedule" returns spoken response
