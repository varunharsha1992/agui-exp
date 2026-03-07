import { DndContext, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core';
import { useEffect, useRef, useState } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import { computeTimeRange, snapTo30, minutesToTime, minutesToPx, timeToMinutes, PX_PER_MIN } from '../utils/time';
import type { Task } from '../store/types';
import TimeRuler from './TimeRuler';
import GanttRow from './GanttRow';

const LABEL_COL_WIDTH = 96;
const ROW_HEIGHT = 64;
const NOW_LINE_INTERVAL_MS = 60_000;

export default function GanttBoard() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, NOW_LINE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const allTasks = Object.values(plan.columns).flatMap((c) => c.tasks);
  const range = computeTimeRange(allTasks);
  const totalWidth = minutesToPx(range.end - range.start);

  const handleDragStart = ({ active }: DragStartEvent) => {
    const task = active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  };

  const handleDragEnd = ({ active, over, delta }: DragEndEvent) => {
    setActiveTask(null);
    if (!over) return;

    const taskId = active.id as string;
    const fromCol = active.data.current?.column as string;
    const toCol = over.id as string;

    const originalTask = plan.columns[fromCol as keyof typeof plan.columns]?.tasks
      .find((t) => t.id === taskId);
    if (!originalTask || originalTask.type === 'fixed') return;

    const deltaMinutes = Math.round(delta.x / PX_PER_MIN);
    const oldStart = originalTask.start_time
      ? timeToMinutes(originalTask.start_time)
      : range.start;
    const rawNew = oldStart + deltaMinutes;
    const newStartMinutes = snapTo30(rawNew);
    const newStartTime = minutesToTime(newStartMinutes);

    optimisticMove(taskId, fromCol, toCol);
    notifyMove(taskId, fromCol, toCol, newStartTime);
  };

  const nowLeft = LABEL_COL_WIDTH + minutesToPx(nowMinutes - range.start);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
        <div style={{ minWidth: LABEL_COL_WIDTH + totalWidth }}>
          <TimeRuler range={range} labelColWidth={LABEL_COL_WIDTH} />

          <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="relative">
              {nowMinutes >= range.start && nowMinutes <= range.end && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{
                    left: nowLeft,
                    width: 2,
                    background: 'var(--accent)',
                    animation: 'nowPulse 3s ease-in-out infinite',
                  }}
                />
              )}

              {Object.values(plan.columns).map((col) => (
                <GanttRow
                  key={col.id}
                  column={col}
                  range={range}
                  labelColWidth={LABEL_COL_WIDTH}
                  rowHeight={ROW_HEIGHT}
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask && (
                <div style={{ background: 'var(--flex-bg)', border: '1px dashed var(--accent)',
                              borderRadius: 4, padding: '4px 8px', opacity: 0.9 }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                    {activeTask.title}
                  </span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
