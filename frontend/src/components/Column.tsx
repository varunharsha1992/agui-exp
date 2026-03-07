import type { CSSProperties } from 'react';
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

  const loadColors: Record<string, CSSProperties> = {
    light:  { background: 'rgba(74,173,232,0.15)',  color: '#4AADE8'  },
    medium: { background: 'rgba(240,165,0,0.15)',   color: '#F0A500'  },
    heavy:  { background: 'rgba(232,90,74,0.15)',   color: '#E85A4A'  },
  };

  return (
    <div
      ref={setNodeRef}
      className="flex-1 glass-card p-4 min-h-[500px] custom-scrollbar"
      style={isOver ? { borderColor: 'var(--tone-accent)', borderWidth: 2 } : {}}
    >
      {/* Header */}
      <div className="mb-4 border-l-4 pl-3" style={{ borderColor: 'var(--tone-accent)' }}>
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600 }}>
            {column.label}
          </h3>
          <span className="text-xs px-2 py-1 rounded" style={loadColors[column.load_level]}>
            {column.load_level}
          </span>
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        {column.tasks.length === 0 ? (
          <div className="text-center text-sm py-8" style={{ color: 'var(--text-muted)' }}>
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
