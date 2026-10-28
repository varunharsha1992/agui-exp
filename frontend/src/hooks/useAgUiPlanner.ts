import { useCallback, useRef, useEffect } from 'react';
import { HttpAgent } from '@ag-ui/client';
import { usePlannerStore } from '../store/usePlannerStore';
import type { PlannerState } from '../store/types';
import { useThreadId } from './useThreadId';

const AGENT_URL = import.meta.env.VITE_AGENT_URL;
const BACKEND_URL = import.meta.env.VITE_AGENT_URL?.replace('/agent', '');

export function useAgUiPlanner() {
  const store = usePlannerStore();
  const threadId = useThreadId(); // Stable thread_id shared with voice mode
  const agentRef = useRef<HttpAgent | null>(null);

  // Initialize the agent with threadId
  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      if (!AGENT_URL) {
        throw new Error('Missing VITE_AGENT_URL. Set it in your frontend .env.');
      }
      agentRef.current = new HttpAgent({
        url: AGENT_URL,
        threadId: threadId,
        initialState: store.plan,
      });
    }
    return agentRef.current;
  }, [threadId, store.plan]);

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
        onEvent: ({ event }) => {
          console.log('[AG-UI] raw event:', event.type);
        },

        // === Lifecycle Events ===
        
        onRunStartedEvent: () => {
          console.log('[AG-UI] RUN_STARTED');
          store.setStatus('thinking');
        },

        onRunFinishedEvent: () => {
          console.log('[AG-UI] RUN_FINISHED');
          store.setStatus('idle');
          store.clearEphemeralAssistant();
        },

        onRunErrorEvent: ({ event }) => {
          console.warn('[AG-UI] RUN_ERROR:', event.message);
          store.setError(event.message || 'An error occurred');
        },

        // === State Events (Core AG-UI) ===

        onStateSnapshotEvent: ({ event }) => {
          console.log('[AG-UI] STATE_SNAPSHOT received');
          store.setFullState(event.snapshot as PlannerState);
        },

        onStateDeltaEvent: ({ event }) => {
          console.log('[AG-UI] STATE_DELTA received:', event.delta);
          store.applyDelta(event.delta);
        },

        // === Text Message Events (assistant messages only; progress uses ACTIVITY) ===

        onTextMessageStartEvent: ({ event }) => {
          console.log('[AG-UI] TEXT_MESSAGE_START:', event.messageId);
          store.startAssistantMessage(event.messageId);
        },

        onTextMessageContentEvent: ({ event }) => {
          if (!event.messageId) return;
          store.appendToAssistantMessage(event.messageId, event.delta);
        },

        onTextMessageEndEvent: () => {
          console.log('[AG-UI] TEXT_MESSAGE_END');
        },

        // === Activity Events (progress is ACTIVITY_SNAPSHOT with activityType PROGRESS) ===

        onActivitySnapshotEvent: ({ event }) => {
          if (event.activityType !== 'PROGRESS') return;
          const content = event.content as { text?: string } | undefined;
          const text = content?.text ?? '';
          console.log('[AG-UI] ACTIVITY_SNAPSHOT (PROGRESS):', text || '(cleared)');
          if (text) {
            store.setEphemeralAssistant(event.messageId, text);
          }
        },

        // === Tool Call Events ===

        onToolCallStartEvent: ({ event }) => {
          console.log('[AG-UI] TOOL_CALL_START:', event.toolCallName, event.toolCallId);
          store.startToolCall(event.toolCallId, event.toolCallName);
        },

        onToolCallEndEvent: ({ event }) => {
          console.log('[AG-UI] TOOL_CALL_END:', event.toolCallId);
          store.endToolCall(event.toolCallId);
        },

        onToolCallResultEvent: ({ event }) => {
          console.log('[AG-UI] onToolCallResultEvent received:', {
            toolCallId: event.toolCallId,
            content: event.content,
          });
          try {
            const result = JSON.parse(event.content || '{}');
            if (result._mcpApp) {
              console.log('[AG-UI] _mcpApp detected, adding to store:', {
                resourceUri: result._mcpApp.resourceUri,
                mcpServerUrl: result._mcpApp.mcpServerUrl,
              });
              store.addMcpAppMessage({
                toolCallId: event.toolCallId,
                resourceUri: result._mcpApp.resourceUri,
                mcpServerUrl: result._mcpApp.mcpServerUrl,
                toolResult: result,
              });
            }
          } catch {
            // Not JSON or no _mcpApp — normal tool result, ignore
          }
        },
      });
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Connection failed');
    }
  }, [store, getAgent]);

  // Send move action to backend (no LLM) to keep state in sync
  const notifyMove = useCallback(async (taskId: string, fromCol: string, toCol: string, startTime?: string) => {
    try {
      if (!BACKEND_URL) {
        throw new Error('Missing VITE_AGENT_URL. Set it in your frontend .env.');
      }
      const threadIdForAction = threadId;
      await fetch(`${BACKEND_URL}/agent/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          thread_id: threadIdForAction,
          action: 'move_task',
          payload: {
            task_id: taskId,
            target_day: toCol,
            ...(startTime ? { start_time: startTime } : {}),
          },
        }),
      });
    } catch (err) {
      console.error('Failed to apply move_task action:', err);
    }
  }, [threadId]);

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
