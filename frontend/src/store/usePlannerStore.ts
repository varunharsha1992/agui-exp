import { create } from 'zustand';
import { applyPatch, Operation } from 'fast-json-patch';
import type { PlannerState, ChatMessage, ToolCall, VoiceStatus, McpAppMessage } from './types';

// Default State Helpers

const DEFAULT_COLUMN = (id: 'today' | 'tomorrow' | 'next', label: string) => ({
  id,
  label,
  load_level: 'light' as const,
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

// Store Interface

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
  
  // Voice state
  voiceMode: boolean;
  voiceStatus: VoiceStatus;

  // MCP App state
  mcpAppMessages: McpAppMessage[];

  // Ephemeral assistant progress bubble
  ephemeralAssistant: { id: string; content: string } | null;

  // Actions
  setFullState: (snapshot: PlannerState) => void;
  applyDelta: (patch: Operation[]) => void;
  optimisticMove: (taskId: string, fromCol: string, toCol: string) => void;
  
  // Chat actions
  addUserMessage: (content: string) => string;
  startAssistantMessage: (messageId: string) => void;
  appendToAssistantMessage: (messageId: string, delta: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  
  // Tool call actions
  startToolCall: (id: string, name: string) => void;
  endToolCall: (id: string) => void;
  
  // Status actions
  setStatus: (status: 'idle' | 'thinking' | 'error') => void;
  setError: (error: string | null) => void;
  
  // Voice actions
  setVoiceMode: (active: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;

  // MCP App actions
  addMcpAppMessage: (msg: McpAppMessage) => void;
  removeMcpAppMessage: (toolCallId: string) => void;

  // Ephemeral assistant actions
  setEphemeralAssistant: (id: string, content: string) => void;
  clearEphemeralAssistant: (id?: string) => void;
}

// Store Implementation

export const usePlannerStore = create<Store>((set, get) => ({
  plan: DEFAULT_STATE,
  messages: [],
  currentMessageId: null,
  activeToolCalls: [],
  status: 'idle',
  error: null,
  voiceMode: false,
  voiceStatus: 'idle',
  mcpAppMessages: [],
  ephemeralAssistant: null,

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

  setMessages: (messages) => set({ messages, currentMessageId: null }),

  // Tool call actions
  startToolCall: (id, name) => set((state) => ({
    activeToolCalls: [...state.activeToolCalls, { id, name, status: 'running' }]
  })),

  endToolCall: (id) => set((state) => ({
    activeToolCalls: state.activeToolCalls.filter(tc => tc.id !== id)
  })),

  // Status actions
  setStatus: (status) => set({ status }),
  setError: (error) => set((state) => ({
    error,
    status: error ? 'error' : state.status === 'error' ? 'idle' : state.status,
  })),
  
  // Voice actions
  setVoiceMode: (active) => set({ voiceMode: active }),
  setVoiceStatus: (status) => set({ voiceStatus: status }),

  // MCP App actions (dedupe by toolCallId: agent stream + subscribe both can emit same result)
  addMcpAppMessage: (msg) => set((state) => {
    if (state.mcpAppMessages.some((m) => m.toolCallId === msg.toolCallId)) return state;
    return { mcpAppMessages: [...state.mcpAppMessages, msg] };
  }),
  removeMcpAppMessage: (toolCallId) => set((state) => ({
    mcpAppMessages: state.mcpAppMessages.filter(m => m.toolCallId !== toolCallId)
  })),

  // Ephemeral assistant actions
  setEphemeralAssistant: (id, content) => set(() => ({ ephemeralAssistant: { id, content } })),
  clearEphemeralAssistant: (id) => set((state) => {
    if (!state.ephemeralAssistant) return state;
    if (id && state.ephemeralAssistant.id !== id) return state;
    return { ephemeralAssistant: null };
  })
}));
