import { describe, it, expect } from 'vitest';
import { timeToMinutes, minutesToTime, snapTo30, computeTimeRange } from './time';
import type { Task } from '../store/types';

describe('timeToMinutes', () => {
  it('converts HH:MM to minutes', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('14:30')).toBe(870);
  });
});

describe('minutesToTime', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(870)).toBe('14:30');
  });
});

describe('snapTo30', () => {
  it('snaps to nearest 30-min boundary', () => {
    expect(snapTo30(545)).toBe(540); // 9:05 → 9:00
    expect(snapTo30(556)).toBe(570); // 9:16 → 9:30
  });
});

describe('computeTimeRange', () => {
  it('returns default working hours when no tasks', () => {
    const range = computeTimeRange([]);
    expect(range.start).toBe(9 * 60);
    expect(range.end).toBe(19 * 60);
  });

  it('expands to fit tasks outside default range', () => {
    const tasks: Partial<Task>[] = [
      { start_time: '07:30', duration_minutes: 60 },
      { start_time: '19:00', duration_minutes: 60 },
    ];
    const range = computeTimeRange(tasks as Task[]);
    expect(range.start).toBeLessThanOrEqual(7 * 60);
    expect(range.end).toBeGreaterThanOrEqual(20 * 60);
  });
});
