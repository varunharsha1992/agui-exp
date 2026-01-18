UI Contract for STATE_SNAPSHOT: The UI (React): It receives the Snapshot to build the initial store, and then automatically applies the Deltas to that store. You don't write custom "move task" logic in React; the protocol handles the state patch.
// Enums for rigid constraints
type VisualTone = 'calm' | 'neutral' | 'tight';
type LoadLevel = 'light' | 'medium' | 'heavy';
type TaskType = 'fixed' | 'flexible'; // 'fixed' items cannot be dragged
type TaskStatus = 'pending' | 'done' | 'skipped';

// The Core Entity
interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  source?: 'calendar' | 'email' | 'user'; // Optional: useful for UI icons
  duration?: string; // e.g. "30m", optional for MVP
}

// The Container
interface Column {
  id: 'today' | 'tomorrow' | 'next';
  label: string;      // e.g. "Today", "Thu 12"
  loadLevel: LoadLevel; // Agent calculates this based on task density
  tasks: Task[];
}

// The Root State
interface PlannerState {
  globalTone: VisualTone;
  columns: {
    today: Column;
    tomorrow: Column;
    next: Column;
  };
}

Mapped Model in Backend (Agent):
from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel

class VisualTone(str, Enum):
    CALM = "calm"
    NEUTRAL = "neutral"
    TIGHT = "tight"

class LoadLevel(str, Enum):
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"

class TaskType(str, Enum):
    FIXED = "fixed"
    FLEXIBLE = "flexible"

class TaskStatus(str, Enum):
    PENDING = "pending"
    DONE = "done"
    SKIPPED = "skipped"

class Task(BaseModel):
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None  # 'calendar', 'email', 'user'

class Column(BaseModel):
    id: str
    label: str
    load_level: LoadLevel
    tasks: List[Task]

class PlannerState(BaseModel):
    global_tone: VisualTone
    # Using a Dict ensures strict pathing for JSON Patches 
    # e.g., /columns/today/tasks/0
    columns: Dict[str, Column]


AGENT STATE_SNAPSHOT on INITIAL LOAD:
{
  "type": "STATE_SNAPSHOT",
  "snapshot": {
    "global_tone": "neutral",
    "columns": {
      "today": {
        "id": "today",
        "label": "Today",
        "load_level": "medium",
        "tasks": [
          {
            "id": "task-1",
            "title": "9 AM Standup",
            "type": "fixed",
            "status": "pending",
            "source": "calendar"
          }
        ]
      },
      "tomorrow": {
        "id": "tomorrow",
        "label": "Tomorrow",
        "load_level": "light",
        "tasks": []
      },
      "next": {
        "id": "next",
        "label": "Next Day",
        "load_level": "light",
        "tasks": []
      }
    }
  }
}

STATE_DELTA for Incremental Updates (Example A) - You (The Backend Logic): You don't need to manually write "op": "move". You will use a helper (the AG-UI SDK) to compare OldState vs NewState, and it will generate the Delta JSON for you.
{
  "type": "STATE_DELTA",
  "delta": [
    {
      "op": "move",
      "from": "/columns/today/tasks/0",
      "path": "/columns/tomorrow/tasks/0"
    }
  ]
}

Example B: Agent adds a new "Email Task" and changes Tone The Agent can batch multiple changes in one packet.
{
  "type": "STATE_DELTA",
  "delta": [
    {
      "op": "add",
      "path": "/columns/today/tasks/-", 
      "value": {
        "id": "task-99",
        "title": "Submit Budget Report",
        "type": "flexible",
        "status": "pending",
        "source": "email"
      }
    },
    {
      "op": "replace",
      "path": "/global_tone",
      "value": "tight"
    }
  ]
}

3. The Explanation (TEXT_MESSAGE_CHUNK)
While the UI is updating via the Deltas above, the Agent simultaneously sends text to the chat panel.

{
  "type": "TEXT_MESSAGE_CHUNK",
  "delta": "I noticed your schedule is tight, so I moved the budget report to..."
}

Yes, let's define the events. Since AG-UI is an event-driven protocol, the "API" is actually just a stream of these specific event objects sent over the wire (usually via Server-Sent Events or WebSockets).

For your Rolling 3-Day Planner MVP, you will use 4 specific categories of standard AG-UI events.

1. State Management Events (The Core)
These are the most critical events for your "AG-UI" concept. They directly manipulate the PlannerState we defined earlier.

STATE_SNAPSHOT


When to send: Immediately upon connection or when the user refreshes the page.

Payload: The full JSON object of your PlannerState (all 3 columns, all tasks, current tone).


Effect: The frontend completely replaces its store with this data.

STATE_DELTA


When to send: Whenever the agent moves a task, changes a status, or updates the visual tone.
+1


Payload: An array of JSON Patch operations (RFC 6902).
+1


Effect: The frontend applies these small patches to the current state without re-rendering the whole page.

Example Delta JSON (Agent moving a task):

JSON

{
  "type": "STATE_DELTA",
  "delta": [
    { "op": "move", "from": "/columns/today/tasks/2", "path": "/columns/tomorrow/tasks/0" },
    { "op": "replace", "path": "/global_tone", "value": "calm" }
  ]
}

Since you want the agent to use "valid tool calls" to fetch your mock data (Mock Calendar/Emails), you will use these events to visualize the agent's actions. Look into AG-UI documentation to see how to emit tool call events

TOOL_CALL_START / TOOL_CALL_END


When to send: When the agent decides to "Read Calendar" or "Fetch Emails".

Effect: The UI can show a spinner or a status pill: "Checking Calendar..."

TOOL_CALL_RESULT


When to send: After your Python function reads the mock file and returns data.

Effect: The Agent receives the data to make its planning decisions. The UI can display this result if you want transparency (e.g., "Found 3 meetings").

Lifecycle Events (The Indicators)
These tell the UI when the agent is "working."

RUN_STARTED


When to send: When the user sends a message or drops a task (if agent validation is on).

Effect: UI enters "loading/thinking" state.

RUN_FINISHED


When to send: When the agent is done planning.

Effect: UI returns to idle/interactive state.

Summary of the Event Stream
A single interaction (User: "Balance my day") would look like this stream of JSON objects:

RUN_STARTED

TOOL_CALL_START (fetch_mock_calendar)

TOOL_CALL_RESULT (returns mock data)

TEXT_MESSAGE_CHUNK ("I see you have a board meeting...")

STATE_DELTA (Moves conflicting task to tomorrow)

TEXT_MESSAGE_CHUNK ("...so I moved the deep work block to Tuesday.")

RUN_FINISHED