# Voice UI Spec (Frontend)

## Role
Manage the **modal switch** between Text Mode and Voice Mode.

---

## UX State Machine

### Text Mode (Default)
- Standard AG-UI chat interface
- LiveKit: **Disconnected**
- Mic: **Off**
- Calls: `http://localhost:8000/agent` directly

### Voice Mode
- **Trigger**: User clicks "Start Voice Session"
- LiveKit: **Connected**
- Mic: **Published**
- Text input: **Disabled**
- Visual: Simple indicator (pulsing dot or waveform)

---

## Service Endpoints

The frontend talks to **two** backend services:

| Mode | Endpoint | Service |
|------|----------|---------|
| Text Chat | `POST /agent` | `project-planning-agent` (port 8000) |
| Voice Token | `GET /livekit/token` | `livekit-adaptor` (port 8001) |
| Voice Audio | WebRTC | Local LiveKit Server (ws://localhost:7880) |

---

## Connection Flow

1. User clicks "Start Voice"
2. Fetch token: `GET http://localhost:8001/livekit/token?identity=user&room=planner`
3. Response: `{ "token": "...", "url": "ws://localhost:7880" }`
4. Connect to room: `room.connect(url, token)`
5. Enable mic: `room.localParticipant.setMicrophoneEnabled(true)`
6. Agent joins automatically (when agent worker is running and connected to local LiveKit server)
7. Agent audio auto-plays via track subscription

---

## Key Frontend Additions

### Dependencies
```
npm install livekit-client
```

### Environment Variables
```
VITE_AGUI_BACKEND_URL=http://localhost:8000
VITE_LIVEKIT_TOKEN_URL=http://localhost:8001/livekit/token
```

### Zustand Store Additions
```typescript
// Add to existing store
voiceMode: boolean
voiceStatus: 'idle' | 'connecting' | 'connected' | 'error'

setVoiceMode: (active: boolean) => void
setVoiceStatus: (status: string) => void
```

### Hook: useVoiceMode
Create `hooks/useVoiceMode.ts`:
- `connect()` - fetch token from livekit-adaptor, join room, publish mic
- `disconnect()` - leave room
- `toggleVoiceMode()` - switch between modes
- Auto-attach agent audio tracks

### UI Component: Voice Toggle
Add to ChatPanel header:
- Mic button that toggles voice mode
- Visual indicator when connected (pulsing)
- Status text: "Listening...", "Connected", etc.

---

## Audio Handling

### Publishing User Audio
```typescript
await room.localParticipant.setMicrophoneEnabled(true);
```

### Subscribing to Agent Audio
```typescript
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind === 'audio') {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    track.attach(audio);
  }
});
```

---

## Token Endpoint (in livekit-adaptor/)

The token endpoint lives in the **livekit-adaptor** service, NOT in project-planning-agent.

Location: `livekit-adaptor/token_server.py`

```python
# Runs on port 8001
@app.get("/livekit/token")
async def get_token(identity: str, room: str = "planner-room"):
    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    token.identity = identity
    token.add_grant(api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_subscribe=True,
    ))
    return {
        "token": token.to_jwt(),
        "url": LIVEKIT_URL
    }
```

---

## What's NOT in Scope (POC)

- ❌ Data packets for UI sync
- ❌ Voice transcription in chat history  
- ❌ Visual waveform animations
- ❌ "Thinking" status from agent
- ❌ Concurrent voice + text input

---

## Implementation Checklist

### livekit-adaptor/ (New Service)
- [ ] Create folder structure
- [ ] Create `requirements.txt` with LiveKit packages
- [ ] Create `.env.example` with required vars
- [ ] Implement `token_server.py` (FastAPI, port 8001)
- [ ] Implement `agent.py` (LiveKit worker)
- [ ] Test token endpoint returns valid JWT
- [ ] Test agent connects to local LiveKit server

### Frontend
- [ ] Install `livekit-client`
- [ ] Add `VITE_LIVEKIT_TOKEN_URL` env var
- [ ] Add voice state to Zustand store
- [ ] Create `useVoiceMode` hook
- [ ] Add voice toggle button to ChatPanel
- [ ] Test: click voice → speak → hear response

### Integration Test
- [ ] AG-UI backend running on :8000
- [ ] Token server running on :8001
- [ ] LiveKit agent worker running
- [ ] Frontend can toggle voice mode
- [ ] End-to-end voice conversation works
