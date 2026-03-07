import { useDraggable } from '@dnd-kit/core';
import type { CSSProperties } from 'react';
import type { Task } from '../store/types';
import { timeToMinutes, minutesToPx } from '../utils/time';

interface GanttBlockProps {
  task: Task;
  rangeStartMinutes: number;
  columnId: string;
}

export default function GanttBlock({ task, rangeStartMinutes, columnId }: GanttBlockProps) {
  const isFixed = task.type === 'fixed';
  const hasTime = !!task.start_time && !!task.duration_minutes;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, column: columnId, kind: 'gantt' },
    disabled: isFixed,
  });

  const left  = hasTime ? minutesToPx(timeToMinutes(task.start_time!) - rangeStartMinutes) : 0;
  const width = hasTime ? minutesToPx(task.duration_minutes!) : 120;

  const blockStyle: CSSProperties = {
    position: 'absolute',
    left,
    width,
    top: 8,
    height: 40,
    borderRadius: 4,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    cursor: isFixed ? 'default' : 'grab',
    opacity: isDragging ? 0.5 : 1,
    userSelect: 'none',
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
    ...(!hasTime
      ? { background: 'repeating-linear-gradient(45deg, #1A2535 0px, #1A2535 8px, #1D2B3A 8px, #1D2B3A 16px)', border: '1px dashed var(--flex-border)' }
      : isFixed
      ? { background: 'var(--fixed-bg)', border: '1px solid var(--fixed-border)' }
      : { background: 'var(--flex-bg)', border: '1px dashed var(--flex-border)' }
    ),
  };

  return (
    <div ref={setNodeRef} style={blockStyle} {...(!isFixed ? { ...listeners, ...attributes } : {})}>
      {isFixed && <span style={{ fontSize: '0.65rem', marginRight: 4, color: 'var(--fixed-border)' }}>🔒</span>}
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem',
                     color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.title}
      </span>
    </div>
  );
}
