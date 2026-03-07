import { useEffect, useRef } from 'react';
import { usePlannerStore } from '../store/usePlannerStore';
import { useThreadId } from './useThreadId';
import type { PlannerState } from '../store/types';

const BACKEND_URL = import.meta.env.VITE_AGENT_URL?.replace('/agent', '') || 'http://localhost:8000';

export function useStateSubscription() {
  const threadId = useThreadId();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Get store methods directly - these are stable references
    const { applyDelta, setFullState, setStatus, addMcpAppMessage, setMessages, setEphemeralAssistant, clearEphemeralAssistant } = usePlannerStore.getState();

    // Create EventSource connection
    const eventSource = new EventSource(
      `${BACKEND_URL}/agent/subscribe/${threadId}`
    );

    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        // SSE format: "data: {...}"
        let eventData = event.data;
        if (eventData.startsWith('data: ')) {
          eventData = eventData.slice(6); // Remove "data: " prefix
        }
        
        const data = JSON.parse(eventData);
        const eventType = data.type;

        if (eventType === 'STATE_DELTA') {
          // Apply delta to current state
          applyDelta(data.delta);
        } else if (eventType === 'STATE_SNAPSHOT') {
          // Replace entire state
          setFullState(data.snapshot as PlannerState);
        } else if (eventType === 'RUN_STARTED') {
          // Update status to "thinking" when run starts
          // This is needed for voice mode to show thinking status
          setStatus('thinking');
        } else if (eventType === 'RUN_FINISHED') {
          // Update status to "idle" when run finishes
          setStatus('idle');
          // Sync messages from backend so voice Q&A appears in chat panel
          fetch(`${BACKEND_URL}/agent/history/${threadId}`)
            .then((res) => res.ok ? res.json() : null)
            .then((body: { messages?: Array<{ id: string; role: string; content: string }> } | null) => {
              if (body?.messages && Array.isArray(body.messages)) {
                const mapped = body.messages.map((m) => ({
                  id: m.id,
                  role: m.role as 'user' | 'assistant',
                  content: m.content ?? ''
                }));
                setMessages(mapped);
              }
            })
            .catch((err) => console.error('Failed to fetch history after RUN_FINISHED:', err));
        } else if (eventType === 'TOOL_CALL_RESULT') {
          // MCP app frames (e.g. Todoist) from voice runs – mirror useAgUiPlanner logic
          const toolCallId = data.tool_call_id ?? data.toolCallId;
          const content = data.content;
          if (!toolCallId || content == null) return;
          try {
            const result = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content));
            if (result._mcpApp) {
              addMcpAppMessage({
                toolCallId,
                resourceUri: result._mcpApp.resourceUri,
                mcpServerUrl: result._mcpApp.mcpServerUrl,
                toolResult: result
              });
            }
          } catch {
            // Not JSON or no _mcpApp — normal tool result, ignore
          }
        } else if (eventType === 'ACTIVITY_SNAPSHOT') {
          const { voiceMode } = usePlannerStore.getState();
          if (!voiceMode) return;
          if ((data.activityType ?? data.activity_type) !== 'PROGRESS') return;

          const messageId: string | undefined = data.message_id ?? data.messageId;
          const content = data.content as { text?: string } | undefined;
          const text = content?.text ?? '';
          if (messageId) {
            if (text) {
              setEphemeralAssistant(messageId, text);
            } else {
              clearEphemeralAssistant(messageId);
            }
          }
        } else if (eventType === 'TEXT_MESSAGE_START' || eventType === 'TEXT_MESSAGE_CONTENT' || eventType === 'TEXT_MESSAGE_END') {
          // Progress no longer sent as text; handled via ACTIVITY_SNAPSHOT
          const { voiceMode } = usePlannerStore.getState();
          if (!voiceMode) return;
        }
      } catch (error) {
        console.error('Failed to parse state subscription event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('State subscription error:', error);
      // EventSource will auto-reconnect on close
    };

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [threadId]); // Only depend on threadId, not store

  // Return nothing - this hook only manages the subscription
  return null;
}
