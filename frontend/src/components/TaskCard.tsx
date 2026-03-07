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
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const isFixed = task.type === 'fixed';

  const cardStyle = isFixed
    ? { background: 'var(--fixed-bg)', borderColor: 'var(--fixed-border)', borderWidth: 1, borderStyle: 'solid' }
    : task.status === 'done'
    ? { background: 'var(--done-bg)', borderColor: 'var(--done-border)', borderWidth: 1, borderStyle: 'solid' }
    : { background: 'var(--flex-bg)', borderColor: 'var(--flex-border)', borderWidth: 1, borderStyle: 'dashed' };

  const sourceIcons: Record<string, string> = {
    calendar: '📅',
    email: '📧',
    user: '👤'
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...cardStyle, opacity: isDragging ? 0.5 : 1, borderRadius: 6 }}
      {...(!isFixed ? { ...listeners, ...attributes } : {})}
      className={`p-3 mb-2 ${isFixed ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isFixed && <span className="text-xs">🔒</span>}
            {task.source && (
              <span className="text-xs">{sourceIcons[task.source] || '📌'}</span>
            )}
            <h4
              className={task.status === 'done' ? 'line-through' : ''}
              style={{ fontFamily: 'var(--font-body)', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}
            >
              {task.title}
            </h4>
          </div>
          {(task.duration_minutes || task.start_time) && (
            <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: 4 }}>
              {task.start_time && `${task.start_time}`}
              {task.duration_minutes && task.start_time && ' · '}
              {task.duration_minutes && `${task.duration_minutes}m`}
            </p>
          )}
        </div>
        {task.status !== 'pending' && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            {task.status}
          </span>
        )}
      </div>
    </div>
  );
}
