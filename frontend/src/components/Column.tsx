import { useDroppable } from '@dnd-kit/core';
import type { Column as ColumnType } from '../store/types';
import TaskCard from './TaskCard';

interface ColumnProps {
  column: ColumnType;
}

export default function Column({ column }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  const loadColors = {
    light: 'bg-green-100/50 text-green-700',
    medium: 'bg-yellow-100/50 text-yellow-700',
    heavy: 'bg-red-100/50 text-red-700'
  };

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 glass-card p-4 min-h-[500px]
        ${isOver ? 'bg-blue-100/30 border-blue-400 border-2' : ''}
      `}
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">{column.label}</h3>
          <span className={`text-xs px-2 py-1 rounded ${loadColors[column.load_level]}`}>
            {column.load_level}
          </span>
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        {column.tasks.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            No tasks
          </div>
        ) : (
          column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} columnId={column.id} />
          ))
        )}
      </div>
    </div>
  );
}
