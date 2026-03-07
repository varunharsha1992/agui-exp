import type { Task } from '../store/types';

export const PX_PER_MIN = 2;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function snapTo30(minutes: number): number {
  return Math.round(minutes / 30) * 30;
}

export interface TimeRange {
  start: number;  // minutes from midnight
  end: number;
}

const DEFAULT_START = 9 * 60;   // 09:00
const DEFAULT_END   = 19 * 60;  // 19:00
const PADDING       = 30;        // 30-min padding around earliest/latest task

export function computeTimeRange(tasks: Task[]): TimeRange {
  const scheduled = tasks.filter((t) => t.start_time && t.duration_minutes);
  if (scheduled.length === 0) return { start: DEFAULT_START, end: DEFAULT_END };

  const starts = scheduled.map((t) => timeToMinutes(t.start_time!));
  const ends   = scheduled.map((t) => timeToMinutes(t.start_time!) + t.duration_minutes!);

  const earliest = Math.min(...starts) - PADDING;
  const latest   = Math.max(...ends) + PADDING;

  return {
    start: Math.min(DEFAULT_START, Math.floor(earliest / 60) * 60),
    end:   Math.max(DEFAULT_END,   Math.ceil(latest / 60) * 60),
  };
}

export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MIN;
}
