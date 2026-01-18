import { useCallback, useRef, useEffect } from 'react';
import { HttpAgent } from '@ag-ui/client';
import { usePlannerStore } from '../store/usePlannerStore';
import type { PlannerState } from '../store/types';

const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/agent';

export function useAgUiPlanner() {
  const store = usePlannerStore();
  const agentRef = useRef<HttpAgent | null>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());

  // Initialize the agent with threadId
  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      agentRef.current = new HttpAgent({
        url: AGENT_URL,
        threadId: threadIdRef.current,
        initialState: store.plan
      });
    }
    return agentRef.current;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const agent = getAgent();
    
    // Add user message to chat first (Zustand updates are synchronous)
    store.addUserMessage(text);
    store.setStatus('thinking');
    store.setError(null);

    // Get updated messages after adding user message
    const currentState = usePlannerStore.getState();
    
    // Update agent's messages and state before running
    agent.messages = currentState.messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));
    agent.state = currentState.plan;

    try {
      await agent.runAgent({
        runId: crypto.randomUUID(),
        tools: [],
        context: [],
        forwardedProps: null
      }, {
        // === Lifecycle Events ===
        
        onRunStartedEvent: () => {
          store.setStatus('thinking');
        },

        onRunFinishedEvent: () => {
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

        onTextMessageEndEvent: () => {
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
