# UI Implementation Specification: Rolling 3-Day Planner MVP

This spec is designed to be "load-once, update-via-deltas," ensuring the UI stays responsive while the Agent streams updates in the background.

**Important**: All property names use `snake_case` to match the backend exactly. This ensures JSON Patches apply correctly without transformation.

---

## 1. The Layout (Visual Spec)

The UI follows a rigid Split-Screen architecture to separate "Intent" (Chat) from "State" (Plan).

### Left Panel: The Negotiation Stream (30% Width)

- **Header**: Agent Status Indicator (Idle / Thinking / Rebalancing...).
- **Message Stream**: Standard chat interface.
  - Agent Messages: Stream in token-by-token via `TEXT_MESSAGE_CONTENT` events.
  - Tool Indicators: "Checking Calendar..." (Collapsible pills triggered by `TOOL_CALL_START`).
- **Input Area**: Simple text box. "Talk to your planner."

### Right Panel: The Shared State (70% Width)

- **Header**: Global Visual Tone Indicator (e.g., a subtle background gradient: Blue=Calm, Orange=Tight).
- **The Board**: 3 Vertical Columns (Flexbox/Grid).
  - Column 1: Today (Highlighted).
  - Column 2: Tomorrow.
  - Column 3: Next.
- **The Cards (Task Items)**:
  - Fixed Event: Different visual style (e.g., solid border, lock icon). Draggable: No.
  - Flexible Task: Standard card style. Draggable: Yes.
  - Ghost Card: Appears during "Optimistic UI" updates (when you drag).

---

## 2. Implementation Strategy (React + AG-UI Client)

We use the official `@ag-ui/client` SDK to handle SSE stream parsing, and `fast-json-patch` to apply the Agent's updates.

### A. The Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Framework | React (Vite) | UI rendering |
| Protocol Client | `@ag-ui/client` | SSE connection & event parsing |
| State Management | `zustand` | Holds the "Shared State" |
| Patching | `fast-json-patch` | Applies STATE_DELTA events |
| Drag & Drop | `dnd-kit` | Moving tasks between columns |

### B. State Definition (The Store)

The Frontend Store mirrors the Backend Pydantic model **exactly** (snake_case).

```typescript
import { create } from 'zustand';
import { applyPatch, Operation } from 'fast-json-patch';

// === Type Definitions (Match Backend Exactly) ===

type VisualTone = 'calm' | 'neutral' | 'tight';
type LoadLevel = 'light' | 'medium' | 'heavy';
type TaskType = 'fixed' | 'flexible';
type TaskStatus = 'pending' | 'done' | 'skipped';

interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  source?: 'calendar' | 'email' | 'user';
  duration?: string; // e.g., "30m"
}

interface Column {
  id: 'today' | 'tomorrow' | 'next';
  label: string;
  load_level: LoadLevel;  // snake_case to match backend
  tasks: Task[];
}

interface PlannerState {
  global_tone: VisualTone;  // snake_case to match backend
  columns: {
    today: Column;
    tomorrow: Column;
    next: Column;
  };
}

// === Chat Message Types ===

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'completed';
}

// === Store Interface ===

interface Store {
  // The Single Source of Truth
  plan: PlannerState;
  
  // Chat state
  messages: ChatMessage[];
  currentMessageId: string | null;
  activeToolCalls: ToolCall[];
  
  // UI state
  status: 'idle' | 'thinking' | 'error';
  error: string | null;
  
  // Actions
  setFullState: (snapshot: PlannerState) => void;
  applyDelta: (patch: Operation[]) => void;
  optimisticMove: (taskId: string, fromCol: string, toCol: string) => void;
  
  // Chat actions
  addUserMessage: (content: string) => string;
  startAssistantMessage: (messageId: string) => void;
  appendToAssistantMessage: (messageId: string, delta: string) => void;
  
  // Tool call actions
  startToolCall: (id: string, name: string) => void;
  endToolCall: (id: string) => void;
  
  // Status actions
  setStatus: (status: 'idle' | 'thinking' | 'error') => void;
  setError: (error: string | null) => void;
}

// === Default State ===

const DEFAULT_COLUMN = (id: 'today' | 'tomorrow' | 'next', label: string): Column => ({
  id,
  label,
  load_level: 'light',
  tasks: []
});

const DEFAULT_STATE: PlannerState = {
  global_tone: 'neutral',
  columns: {
    today: DEFAULT_COLUMN('today', 'Today'),
    tomorrow: DEFAULT_COLUMN('tomorrow', 'Tomorrow'),
    next: DEFAULT_COLUMN('next', 'Next Day')
  }
};

// === Store Implementation ===

export const usePlannerStore = create<Store>((set, get) => ({
  plan: DEFAULT_STATE,
  messages: [],
  currentMessageId: null,
  activeToolCalls: [],
  status: 'idle',
  error: null,

  // Called on STATE_SNAPSHOT
  setFullState: (snapshot) => set({ plan: snapshot }),

  // Called on STATE_DELTA
  applyDelta: (patch) => set((state) => {
    try {
      // Deep clone to avoid mutation issues
      const clonedPlan = JSON.parse(JSON.stringify(state.plan));
      const result = applyPatch(clonedPlan, patch, true, false);
      return { plan: result.newDocument };
    } catch (e) {
      console.error('Failed to apply patch:', e, patch);
      return state; // Return unchanged on error
    }
  }),

  // Optimistic Update (User Drags Card)
  optimisticMove: (taskId, fromCol, toCol) => set((state) => {
    const plan = JSON.parse(JSON.stringify(state.plan)) as PlannerState;
    const fromColumn = plan.columns[fromCol as keyof typeof plan.columns];
    const toColumn = plan.columns[toCol as keyof typeof plan.columns];
    
    if (!fromColumn || !toColumn) return state;
    
    const taskIndex = fromColumn.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return state;
    
    // Only allow moving flexible tasks
    const task = fromColumn.tasks[taskIndex];
    if (task.type === 'fixed') return state;
    
    // Remove from source, add to target
    fromColumn.tasks.splice(taskIndex, 1);
    toColumn.tasks.push(task);
    
    return { plan };
  }),

  // Chat actions
  addUserMessage: (content) => {
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [...state.messages, { id, role: 'user', content }]
    }));
    return id;
  },

  startAssistantMessage: (messageId) => set((state) => ({
    messages: [...state.messages, { id: messageId, role: 'assistant', content: '' }],
    currentMessageId: messageId
  })),

  appendToAssistantMessage: (messageId, delta) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === messageId ? { ...m, content: m.content + delta } : m
    )
  })),

  // Tool call actions
  startToolCall: (id, name) => set((state) => ({
    activeToolCalls: [...state.activeToolCalls, { id, name, status: 'running' }]
  })),

  endToolCall: (id) => set((state) => ({
    activeToolCalls: state.activeToolCalls.filter(tc => tc.id !== id)
  })),

  // Status actions
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? 'error' : 'idle' })
}));
```

### C. The AG-UI Client Hook

We use `HttpAgent` to connect to the FastAPI server and subscribe to all AG-UI events.

```typescript
import { useCallback, useRef } from 'react';
import { HttpAgent } from '@ag-ui/client';
import { usePlannerStore } from './store';

const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/agent';

export function useAgUiPlanner() {
  const store = usePlannerStore();
  const agentRef = useRef<HttpAgent | null>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());

  // Lazy initialize the agent
  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      agentRef.current = new HttpAgent({ url: AGENT_URL });
    }
    return agentRef.current;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const agent = getAgent();
    
    // Add user message to chat
    const userMessageId = store.addUserMessage(text);
    store.setStatus('thinking');
    store.setError(null);

    // Prepare message history for agent
    const messages = store.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content
    }));

    try {
      await agent.runAgent({
        threadId: threadIdRef.current,
        runId: crypto.randomUUID(),
        messages: messages,
        state: store.plan,
        tools: [],
        context: [],
        forwardedProps: null
      }, {
        // === Lifecycle Events ===
        
        onRunStartedEvent: ({ event }) => {
          store.setStatus('thinking');
        },

        onRunFinishedEvent: ({ event }) => {
          store.setStatus('idle');
        },

        onRunErrorEvent: ({ event }) => {
          store.setError(event.message || 'An error occurred');
        },

        // === State Events (Core AG-UI) ===

        onStateSnapshotEvent: ({ event }) => {
          store.setFullState(event.snapshot as PlannerState);
        },

        onStateDeltaEvent: ({ event }) => {
          store.applyDelta(event.delta);
        },

        // === Text Message Events ===

        onTextMessageStartEvent: ({ event }) => {
          store.startAssistantMessage(event.messageId);
        },

        onTextMessageContentEvent: ({ event }) => {
          if (event.messageId) {
            store.appendToAssistantMessage(event.messageId, event.delta);
          }
        },

        onTextMessageEndEvent: ({ event }) => {
          // Message complete, could trigger any finalization logic
        },

        // === Tool Call Events ===

        onToolCallStartEvent: ({ event }) => {
          store.startToolCall(event.toolCallId, event.toolCallName);
        },

        onToolCallEndEvent: ({ event }) => {
          store.endToolCall(event.toolCallId);
        }
      });
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Connection failed');
    }
  }, [store, getAgent]);

  // Send optimistic move to agent for validation
  const notifyMove = useCallback(async (taskId: string, fromCol: string, toCol: string) => {
    const message = `User moved task ${taskId} from ${fromCol} to ${toCol}`;
    await sendMessage(message);
  }, [sendMessage]);

  return {
    // State (read from store)
    plan: store.plan,
    messages: store.messages,
    status: store.status,
    error: store.error,
    activeToolCalls: store.activeToolCalls,
    
    // Actions
    sendMessage,
    notifyMove,
    optimisticMove: store.optimisticMove
  };
}
```

### D. The Interaction Loop (Drag & Drop)

When the user drags a task:

1. **UI**: `dnd-kit` triggers `onDragEnd`.
2. **Validation**: Check if task is `type: 'flexible'` (fixed tasks cannot be moved).
3. **Store**: Call `optimisticMove()` → Card moves instantly.
4. **Agent Sync**: Call `notifyMove()` → Sends background message to agent.
5. **Agent Response**: 
   - If valid: Agent may send confirming `STATE_DELTA` (or stay silent).
   - If invalid: Agent sends `STATE_DELTA` to revert + `TEXT_MESSAGE_CONTENT` explaining why.

```typescript
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';

function Board() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const fromCol = active.data.current?.column;
    const toCol = over.id as string;

    if (fromCol === toCol) return;

    // Find the task to check if it's movable
    const task = plan.columns[fromCol as keyof typeof plan.columns]?.tasks
      .find(t => t.id === taskId);
    
    if (!task || task.type === 'fixed') {
      // Don't allow moving fixed tasks
      return;
    }

    // 1. Optimistic update (instant visual feedback)
    optimisticMove(taskId, fromCol, toCol);

    // 2. Notify agent (async validation)
    notifyMove(taskId, fromCol, toCol);
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      {/* Board columns render here */}
    </DndContext>
  );
}
```

---

## 3. AG-UI Event Reference

Events emitted by the backend and handled by the frontend:

| Event Type | When Emitted | Frontend Action |
|------------|--------------|-----------------|
| `RUN_STARTED` | Agent begins processing | Set status to "thinking" |
| `RUN_FINISHED` | Agent completes | Set status to "idle" |
| `RUN_ERROR` | Agent encounters error | Show error message |
| `STATE_SNAPSHOT` | Initial state or full replacement | Replace entire store |
| `STATE_DELTA` | Incremental update | Apply JSON Patch |
| `TEXT_MESSAGE_START` | Agent begins response | Create message bubble |
| `TEXT_MESSAGE_CONTENT` | Streaming text chunk | Append to message |
| `TEXT_MESSAGE_END` | Agent finishes response | Finalize message |
| `TOOL_CALL_START` | Agent invokes tool | Show "Checking Calendar..." pill |
| `TOOL_CALL_END` | Tool returns result | Hide tool indicator |

---

## 4. Summary

- **Visuals**: A split-screen layout where the right side is a live projection of the JSON store.
- **Logic**: React components are "dumb." They just render `store.plan`.
- **Updates**: All intelligence happens via `HttpAgent` receiving `STATE_DELTA` patches.
- **Consistency**: All property names use `snake_case` to match backend exactly.
- **No Manual Reducers**: You never write custom "move task" logic—the protocol handles state patches.
