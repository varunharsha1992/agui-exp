# Agents Documentation

This document describes the AI agents in the Rolling 3-Day Planner application.

## Overview

The application uses the **AG-UI Protocol** for bidirectional state synchronization between AI agents and the UI. Two agent interfaces exist:

1. **Planning Agent** - Text-based chat interface (LangChain + FastAPI)
2. **Voice Agent** - Voice interface (LiveKit Agents SDK)

Both agents share the same underlying logic and state, enabling seamless transitions between chat and voice modes.

---

## Planning Agent (Backend)

**Location:** `project-planning-agent/`

### Stack
- **Framework:** LangChain v1 with `create_agent()`
- **Server:** FastAPI with SSE streaming
- **Model:** Configurable via `AGENT_MODEL` env var (default: GPT-4o)

### Role
An executive assistant that helps users manage their rolling 3-day schedule. The agent:
- Fetches calendar events and emails
- Moves flexible tasks between days
- Adds new tasks from various sources
- Balances workload across days
- Adjusts visual tone based on schedule density

### System Prompt Goals
- Manage schedules across Today, Tomorrow, and Next
- Cannot move fixed calendar events (only flexible tasks)
- Rebalance workload by moving tasks to less busy days
- Set visual tone: `calm` (light load), `neutral` (medium), `tight` (heavy)

---

## Voice Agent (LiveKit Adapter)

**Location:** `livekit-adaptor/`

### Stack
- **Framework:** LiveKit Agents Python SDK
- **STT:** AssemblyAI
- **TTS:** Cartesia/OpenAI

### Integration
- Joins the same LiveKit room as the frontend
- Routes voice queries to the AG-UI backend via HTTP
- Fetches conversation history for context continuity
- Broadcasts state updates via room metadata

### Conversation history (voice vs chat)

**Where history is written:** Only the **planning backend** (`project-planning-agent/server.py`) writes the canonical conversation history. In `stream_agent_events()`, after each run it builds `all_messages` from the request’s `input_data.messages` plus the assistant’s text response, then calls `update_history(thread_id, all_messages)`. The frontend does not write history; it either streams messages from the agent (chat) or refetches history after `RUN_FINISHED` (e.g. `/agent/history/{thread_id}`).

**Why the “user” message in chat can differ from what was said in voice:** In voice mode, the voice agent calls the `query_planner` tool with a `user_query` argument. That argument is **chosen by the voice agent’s LLM** (tool routing), not the raw STT transcript. So the text that appears in chat as the user message is whatever the LLM passed as `user_query` (often a rephrased or summarized version of the utterance). The backend simply stores the messages it receives in the POST `/agent` body; it has no access to the original transcript. To make chat show the exact words spoken, the voice agent would need to pass the raw transcript as `user_query` (or send it in a separate field and have the backend use it for the stored user message).

---

## Agent Tools

### Sensors (Read-Only)

| Tool | Description | Parameters |
|------|-------------|------------|
| `fetch_calendar` | Get fixed calendar events | `day_filter`: today/tomorrow/next |
| `fetch_emails` | Get unread emails | `urgency`: high/any |

### Actuators (State Modifiers)

| Tool | Description | Parameters |
|------|-------------|------------|
| `set_full_plan` | Bulk initialize entire plan | `today_tasks`, `tomorrow_tasks`, `next_tasks`, `global_tone` |
| `move_task_in_plan` | Move flexible task to another day | `task_id`, `target_day`, `target_index` |
| `add_task_to_plan` | Create new task | `title`, `day`, `source`, `urgency` |
| `set_visual_tone` | Change UI theme | `tone`: calm/neutral/tight |
| `mark_task_status` | Update task completion | `task_id`, `status`: done/skipped |

**Note:** Tools return signals that the server interprets to generate `STATE_DELTA` events (JSON Patches per RFC 6902).

---

## AG-UI Protocol Events

The agent emits these events during execution:

| Event | Purpose |
|-------|---------|
| `RUN_STARTED` | Agent processing begins |
| `STATE_SNAPSHOT` | Full state payload (on connection/refresh) |
| `TEXT_MESSAGE_CONTENT` | Streaming chat messages |
| `TOOL_CALL_START` | Tool execution begins |
| `TOOL_CALL_END` | Tool result received |
| `STATE_DELTA` | JSON Patch modifying UI state |
| `RUN_FINISHED` | Agent processing complete |

### Example Event Flow

```
User: "Move the report to tomorrow"
  ↓
[RUN_STARTED]
[STATE_SNAPSHOT]
[TOOL_CALL_START] → fetch_calendar
[TOOL_CALL_END]
[TEXT_MESSAGE_CONTENT] → "I see you have 3 meetings..."
[TOOL_CALL_START] → move_task_in_plan
[TOOL_CALL_END]
[STATE_DELTA] → Patch applied to UI
[TEXT_MESSAGE_CONTENT] → "...moved the report"
[RUN_FINISHED]
```

---

## Shared State Schema

```typescript
interface PlannerState {
  global_tone: "calm" | "neutral" | "tight"
  columns: {
    today: Column
    tomorrow: Column
    next: Column
  }
}

interface Column {
  id: "today" | "tomorrow" | "next"
  label: string
  load_level: "light" | "medium" | "heavy"
  tasks: Task[]
}

interface Task {
  id: string
  title: string
  type: "fixed" | "flexible"  // fixed = immovable calendar events
  status: "pending" | "done" | "skipped"
  source: "calendar" | "email" | "user"
  duration?: string
}
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent` | POST | Execute agent (SSE stream) |
| `/agent/state/{thread_id}` | GET | Get current state snapshot |
| `/agent/history/{thread_id}` | GET | Get conversation history |
| `/agent/subscribe/{thread_id}` | GET | Subscribe to state changes (SSE) |
| `/health` | GET | Health check |

---

## Thread Management

- Each session has a stable `thread_id` stored in localStorage
- Shared between text chat and voice channels
- Enables:
  - Conversation history persistence across modes
  - State isolation between users
  - Seamless chat/voice transitions

---

## Configuration

### Environment Variables

**Backend:**
- `AGENT_MODEL` - LLM model to use
- `CORS_ORIGINS` - Allowed CORS origins

**Voice Agent:**
- `LIVEKIT_URL` - LiveKit server URL
- `LIVEKIT_API_KEY` - LiveKit API key
- `LIVEKIT_API_SECRET` - LiveKit API secret
- `ASSEMBLYAI_API_KEY` - STT provider key
- `CARTESIA_API_KEY` - TTS provider key

**Frontend:**
- `VITE_AGENT_URL` - Backend URL (default: http://localhost:8000/agent)
- `VITE_LIVEKIT_TOKEN_URL` - Token server URL

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────┐  ┌───────────────────────────────────────┐ │
│  │  ChatPanel  │  │              Board                    │ │
│  │  (30%)      │  │   Today │ Tomorrow │ Next   (70%)     │ │
│  └──────┬──────┘  └────────────────┬──────────────────────┘ │
│         │                          │                         │
│    useAgUiPlanner            usePlannerStore                │
│    useVoiceMode              (Zustand + JSON Patch)         │
│    useStateSubscription                                      │
└─────────┬───────────────────────────┬───────────────────────┘
          │                           │
          │ HTTP/SSE                  │ Room Metadata
          ▼                           ▼
┌─────────────────────┐      ┌─────────────────────┐
│   FastAPI Backend   │◄────►│   LiveKit Room      │
│   (AG-UI Protocol)  │      │   + Voice Agent     │
│                     │      │                     │
│  ┌───────────────┐  │      │  ┌───────────────┐  │
│  │ LangChain     │  │      │  │ LiveKit SDK   │  │
│  │ Agent         │  │      │  │ STT/TTS       │  │
│  └───────────────┘  │      │  └───────────────┘  │
└─────────────────────┘      └─────────────────────┘
```
