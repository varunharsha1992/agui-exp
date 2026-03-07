import { useDroppable } from '@dnd-kit/core';
import type { Column } from '../store/types';
import type { TimeRange } from '../utils/time';
import { minutesToPx } from '../utils/time';
import GanttBlock from './GanttBlock';

interface GanttRowProps {
  column: Column;
  range: TimeRange;
  labelColWidth: number;
  rowHeight: number;
}

const LOAD_COLORS: Record<string, string> = {
  light:  '#4AADE8',
  medium: '#F0A500',
  heavy:  '#E85A4A',
};

export default function GanttRow({ column, range, labelColWidth, rowHeight }: GanttRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const totalWidth = minutesToPx(range.end - range.start);

  return (
    <div className="flex shrink-0" style={{ height: rowHeight }}>
      {/* Day label */}
      <div style={{ width: labelColWidth, minWidth: labelColWidth, padding: '0 12px',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    borderRight: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600,
                       color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          {column.label}
        </span>
        <span style={{ fontSize: '0.65rem', color: LOAD_COLORS[column.load_level],
                       fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {column.load_level}
        </span>
      </div>

      {/* Timeline area */}
      <div
        ref={setNodeRef}
        className="relative"
        style={{
          width: totalWidth,
          minWidth: totalWidth,
          background: isOver ? 'var(--accent-dim)' : 'transparent',
          borderBottom: '1px solid var(--border)',
          transition: 'background 150ms',
        }}
      >
        {/* 30-min grid lines */}
        {Array.from({ length: Math.floor((range.end - range.start) / 30) }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute', left: minutesToPx(i * 30), top: 0,
            width: 1, height: '100%',
            background: i % 2 === 0 ? 'var(--border)' : 'transparent',
          }} />
        ))}

        {/* Task blocks */}
        {column.tasks.map((task) => (
          <GanttBlock key={task.id} task={task} rangeStartMinutes={range.start} columnId={column.id} />
        ))}
      </div>
    </div>
  );
}
