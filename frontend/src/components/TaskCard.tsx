import { useDraggable } from '@dnd-kit/core';
import type { Task } from '../store/types';

interface TaskCardProps {
  task: Task;
  columnId: string;
}

export default function TaskCard({ task, columnId }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, column: columnId },
    disabled: task.type === 'fixed'
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const isFixed = task.type === 'fixed';
  const statusColors = {
    pending: 'border-gray-300',
    done: 'border-green-300 bg-green-50/50',
    skipped: 'border-gray-300 opacity-60'
  };

  const sourceIcons = {
    calendar: '📅',
    email: '📧',
    user: '👤'
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!isFixed ? { ...listeners, ...attributes } : {})}
      className={`
        glass-card p-3 mb-2 ${isFixed ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
        ${isFixed ? 'border-2 border-blue-400' : statusColors[task.status]}
        ${isDragging ? 'opacity-50' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isFixed && <span className="text-xs">🔒</span>}
            {task.source && (
              <span className="text-xs">{sourceIcons[task.source] || '📌'}</span>
            )}
            <h4 className="font-medium text-sm text-gray-800 truncate">{task.title}</h4>
          </div>
          {task.duration && (
            <p className="text-xs text-gray-500 mt-1">{task.duration}</p>
          )}
        </div>
        {task.status !== 'pending' && (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700">
            {task.status}
          </span>
        )}
      </div>
    </div>
  );
}
