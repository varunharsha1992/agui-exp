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
      <div className="p-4 border-b border-white/30">
        <h1 className="text-2xl font-bold text-gray-800">Rolling 3-Day Planner</h1>
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
              <div className="glass-card p-3 border-2 border-blue-400 opacity-90">
                <h4 className="font-medium text-sm text-gray-800">{activeTask.title}</h4>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
