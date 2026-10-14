import { cn } from '../../primitives/lib/utils';

import { FILL, STROKE, scaleLinear, type ChartColor } from './chart-utils';

export interface SparklineProps {
  values: number[];
  /** Accessible name; carries the meaning (the sparkline sits beside a number already). */
  label: string;
  color?: ChartColor;
  showLastDot?: boolean;
  className?: string;
}

const W = 100;
const H = 24;
const PAD = 4; // room for the 2px line and the last dot

export function Sparkline({
  values,
  label,
  color = 'primary',
  showLastDot,
  className,
}: SparklineProps) {
  if (values.length < 2) return null;
  const x = scaleLinear([0, values.length - 1], [0, W]);
  // higher value → smaller y
  const y = scaleLinear([Math.min(...values), Math.max(...values)], [H - PAD, PAD]);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const last = pts[pts.length - 1]!;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('h-6 w-full overflow-visible', className)}
    >
      <polyline
        points={pts.map(([px, py]) => `${px},${py}`).join(' ')}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={STROKE[color]}
      />
      {showLastDot ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={4}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className={cn(FILL[color], 'stroke-surface')}
        />
      ) : null}
    </svg>
  );
}
