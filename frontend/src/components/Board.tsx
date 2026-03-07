import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import Column from './Column';
import TaskCard from './TaskCard';
import type { Task } from '../store/types';

export default function Board() {
  const { plan, optimisticMove, notifyMove } = useAgUiPlanner();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const fromCol = active.data.current?.column as string;
    const toCol = over.id as string;

    if (fromCol === toCol) return;

    // Find the task to check if it's movable
    const task = plan.columns[fromCol as keyof typeof plan.columns]?.tasks
      .find(t => t.id === taskId);
    
    if (!task || task.type === 'fixed') {
      // Don't allow moving fixed tasks
      return;
    }

    // 1. Optimistic update (instant visual feedback)
    optimisticMove(taskId, fromCol, toCol);

    // 2. Notify agent (async validation)
    notifyMove(taskId, fromCol, toCol);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 600 }}>
          Rolling 3-Day Planner
        </h1>
      </div>

      {/* Board */}
      <div className="flex-1 p-4">
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full">
            <Column column={plan.columns.today} />
            <Column column={plan.columns.tomorrow} />
            <Column column={plan.columns.next} />
          </div>
          
          <DragOverlay>
            {activeTask ? (
              <div className="glass-card p-3 opacity-90" style={{ border: '2px solid var(--tone-accent)' }}>
                <h4 style={{ fontFamily: 'var(--font-body)', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}>{activeTask.title}</h4>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
