import type { TimeRange } from '../utils/time';
import { minutesToTime, minutesToPx } from '../utils/time';

interface TimeRulerProps {
  range: TimeRange;
  labelColWidth: number;
}

export default function TimeRuler({ range, labelColWidth }: TimeRulerProps) {
  const hours: number[] = [];
  const start = Math.floor(range.start / 60) * 60;
  for (let m = start; m <= range.end; m += 60) hours.push(m);

  const totalWidth = minutesToPx(range.end - range.start);

  return (
    <div className="flex shrink-0" style={{ height: 32 }}>
      {/* Spacer for label column */}
      <div style={{ width: labelColWidth, minWidth: labelColWidth }} />
      {/* Ruler */}
      <div className="relative" style={{ width: totalWidth, minWidth: totalWidth }}>
        {hours.map((m) => {
          const left = minutesToPx(m - range.start);
          return (
            <div key={m} className="absolute top-0 h-full flex flex-col justify-end"
                 style={{ left }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                             color: 'var(--text-muted)', transform: 'translateX(-50%)' }}>
                {minutesToTime(m)}
              </span>
              <div style={{ width: 1, height: 8, background: 'var(--border)', marginLeft: '50%' }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
