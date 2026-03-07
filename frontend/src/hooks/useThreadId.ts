import { useRef } from 'react';

const THREAD_ID_KEY = 'planner_thread_id';

export function useThreadId(): string {
  const threadIdRef = useRef<string | null>(null);
  
  if (!threadIdRef.current) {
    const stored = localStorage.getItem(THREAD_ID_KEY);
    if (stored) {
      threadIdRef.current = stored;
    } else {
      threadIdRef.current = crypto.randomUUID();
      localStorage.setItem(THREAD_ID_KEY, threadIdRef.current);
    }
  }
  
  return threadIdRef.current;
}

// Optional: Function to reset thread_id (new conversation)
export function resetThreadId(): string {
  const newId = crypto.randomUUID();
  localStorage.setItem(THREAD_ID_KEY, newId);
  return newId;
}
