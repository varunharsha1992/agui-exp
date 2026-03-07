import { usePlannerStore } from '../store/usePlannerStore';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import Column from './Column';
import TaskCard from './TaskCard';
import GanttBoard from './GanttBoard';
import type { Task } from '../store/types';

export default function Board() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();
  const viewMode = usePlannerStore((s) => s.viewMode);
  const setViewMode = usePlannerStore((s) => s.setViewMode);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const fromCol = active.data.current?.column as string;
    const toCol = over.id as string;
    if (fromCol === toCol) return;
    const task = plan.columns[fromCol as keyof typeof plan.columns]?.tasks.find(t => t.id === taskId);
    if (!task || task.type === 'fixed') return;
    optimisticMove(taskId, fromCol, toCol);
    notifyMove(taskId, fromCol, toCol);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 600 }}>
          Rolling 3-Day Planner
        </h1>
        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['kanban', 'gantt'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 16px',
                fontFamily: 'var(--font-body)',
                fontSize: '0.8rem',
                fontWeight: 500,
                cursor: 'pointer',
                background: viewMode === mode ? 'var(--tone-accent)' : 'var(--bg-elevated)',
                color: viewMode === mode ? '#0E1117' : 'var(--text-secondary)',
                border: 'none',
                transition: 'all 150ms',
              }}
            >
              {mode === 'kanban' ? 'Kanban' : 'Timeline'}
            </button>
          ))}
        </div>
      </div>

      {/* Board content */}
      <div className="flex-1 p-4 overflow-hidden">
        {viewMode === 'gantt' ? (
          <GanttBoard />
        ) : (
          <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-full">
              <Column column={plan.columns.today} />
              <Column column={plan.columns.tomorrow} />
              <Column column={plan.columns.next} />
            </div>
            <DragOverlay>
              {activeTask ? (
                <div className="glass-card p-3" style={{ border: '2px solid var(--tone-accent)', opacity: 0.9 }}>
                  <h4 style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {activeTask.title}
                  </h4>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
