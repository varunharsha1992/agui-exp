# LiveKit Adaptor Service

Voice adapter service that enables voice interactions with the AG-UI planning backend.

## Overview

This service provides:
- **Token Server**: Generates LiveKit access tokens for frontend connections
- **Voice Agent Worker**: Handles speech-to-text, routes queries to backend, and text-to-speech

## Prerequisites

1. **LiveKit Server** (Local)
   - Download from [LiveKit releases](https://github.com/livekit/livekit/releases/latest)
   - Add to PATH
   - Run: `livekit-server --dev`
   - Default: `ws://localhost:7880` with credentials `devkey`/`secret`

2. **Python 3.10+**
   - Required for LiveKit agents

3. **OpenAI API Key**
   - For STT (Speech-to-Text) and TTS (Text-to-Speech)
   - Get from [OpenAI Platform](https://platform.openai.com/api-keys)

4. **AG-UI Backend Running**
   - The existing `project-planning-agent/server.py` must be running on port 8000

## Setup

1. **Install dependencies**:
   ```bash
   cd livekit-adaptor
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```

3. **Download model files** (for Silero VAD):
   ```bash
   python agent.py download-files
   ```

## Running the Services

You need **4 terminals** running simultaneously:

### Terminal 1: LiveKit Server
```bash
livekit-server --dev
```
Runs on `ws://localhost:7880`

### Terminal 2: AG-UI Backend
```bash
cd project-planning-agent
python server.py
```
Runs on `http://localhost:8000`

### Terminal 3: Token Server
```bash
cd livekit-adaptor
python token_server.py
```
Runs on `http://localhost:8001`

### Terminal 4: Agent Worker
```bash
cd livekit-adaptor
python agent.py dev
```
Connects to LiveKit server and waits for room assignments

## Validation

### Level 1: Component Tests

| Test | Command | Expected Result |
|------|---------|-----------------|
| LiveKit server | `curl http://localhost:7880` | Connection response |
| AG-UI backend | `curl http://localhost:8000/health` | `{"status": "healthy"}` |
| Token server | `curl "http://localhost:8001/livekit/token?identity=test"` | JSON with `token` field |
| Token validity | Decode at [jwt.io](https://jwt.io) | Contains `sub`, `video` grant |

### Level 2: Agent Connection

| Test | Action | Expected Result |
|------|--------|-----------------|
| Agent registers | Check Terminal 4 logs | Shows "Worker registered" |
| Agent connects | Check Terminal 4 logs | No connection errors |

### Level 3: Integration Test (LiveKit CLI)

Install LiveKit CLI:
```bash
# Windows
winget install LiveKit.LiveKitCLI
```

Test agent dispatch:
```bash
# Generate token
lk token create --api-key devkey --api-secret secret --identity test-user --room planner-room --join --valid-for 1h

# Join room (this should trigger agent)
lk room join --url ws://localhost:7880 --token <token-from-above>
```

| Test | Action | Expected Result |
|------|--------|-----------------|
| Agent joins | Join room with CLI | Agent appears as participant |
| Agent responds | Speak "Hello" | Agent responds via TTS |

### Level 4: End-to-End Test

1. Start all 4 services (see above)
2. Open frontend and click "Start Voice Session"
3. Speak: "Show me my schedule"
4. Verify:
   - Agent transcribes your speech
   - Backend receives POST to `/agent` (check Terminal 2 logs)
   - Agent speaks the response

### Level 5: Error Handling

| Test | Action | Expected Result |
|------|--------|-----------------|
| Backend down | Stop `server.py`, speak to agent | Agent says error message |
| Invalid token | Use wrong token in frontend | Connection rejected |

## Troubleshooting

### Agent doesn't join room
- Check LiveKit server is running (Terminal 1)
- Check agent worker logs (Terminal 4) for connection errors
- Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env`

### Token generation fails
- Check token server is running (Terminal 3)
- Verify LiveKit credentials in `.env`
- Check token server logs for errors

### Agent can't reach backend
- Verify AG-UI backend is running (Terminal 2)
- Check `AGUI_BACKEND_URL` in `.env` matches backend URL
- Test backend directly: `curl http://localhost:8000/health`

### STT/TTS not working
- Verify `OPENAI_API_KEY` is set in `.env`
- Check OpenAI API key is valid and has credits
- Review agent logs for API errors

## Architecture

```
Frontend (React)
    ↓ WebRTC Audio
LiveKit Server (port 7880)
    ↓ Worker Connection
Agent Worker (agent.py)
    ↓ HTTP POST
AG-UI Backend (port 8000)
    ↓ SSE Response
Agent Worker
    ↓ TTS
Frontend (plays audio)
```

## Files

- `agent.py` - LiveKit agent worker with voice pipeline
- `token_server.py` - FastAPI server for token generation
- `requirements.txt` - Python dependencies
- `.env.example` - Environment variable template
