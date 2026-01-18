// Type definitions matching backend schema exactly (snake_case)

export type VisualTone = 'calm' | 'neutral' | 'tight';
export type LoadLevel = 'light' | 'medium' | 'heavy';
export type TaskType = 'fixed' | 'flexible';
export type TaskStatus = 'pending' | 'done' | 'skipped';

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  source?: 'calendar' | 'email' | 'user';
  duration?: string; // e.g., "30m"
}

export interface Column {
  id: 'today' | 'tomorrow' | 'next';
  label: string;
  load_level: LoadLevel;  // snake_case to match backend
  tasks: Task[];
}

export interface PlannerState {
  global_tone: VisualTone;  // snake_case to match backend
  columns: {
    today: Column;
    tomorrow: Column;
    next: Column;
  };
}

// Chat Message Types

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'completed';
}
