import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../../primitives/lib/utils';

import {
  FILL,
  STROKE,
  nearestIndex,
  niceMax,
  scaleLinear,
  ticks,
  type ChartColor,
} from './chart-utils';

export interface LineChartPoint {
  /** Already formatted, e.g. "অক্টো". */
  x: string;
  y: number;
  /** Already formatted, e.g. "৳৯৫,৫০০". */
  valueLabel: string;
}

export interface LineChartProps {
  /** Accessible name = the summary sentence. */
  label: string;
  points: LineChartPoint[];
  formatTick: (n: number) => string;
  /** Default [0, niceMax(max)]. */
  yDomain?: [number, number];
  target?: { value: number; label: string };
  /** The segment from i-1 to i is dotted (the month is still running). */
  inProgressFrom?: number | undefined;
  /** Labels from this index are muted and have no point. */
  futureFrom?: number | undefined;
  /** Indices that get a marker and a direct label. */
  labelled?: number[];
  /** Bold x label. */
  currentIndex?: number | undefined;
  tooltipLabel?: (p: LineChartPoint) => string;
  color?: ChartColor;
  height?: number;
  className?: string;
}

const FALLBACK_W = 600; // jsdom has no layout
const PAD = { l: 48, r: 12, t: 20, b: 28 };

export function LineChart({
  label,
  points,
  formatTick,
  yDomain,
  target,
  inProgressFrom,
  futureFrom,
  labelled = [],
  currentIndex,
  tooltipLabel = (p) => `${p.x}: ${p.valueLabel}`,
  color = 'primary',
  height = 220,
  className,
}: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_W);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length]);

  if (points.length === 0 || (futureFrom !== undefined && futureFrom <= 0)) return null;

  const n = points.length;
  const last = Math.min(futureFrom ?? n, n) - 1; // last drawn index
  const drawn = points.slice(0, last + 1);
  const max = Math.max(...drawn.map((p) => p.y), target?.value ?? 0);
  const domain: [number, number] = yDomain ?? [0, niceMax(max)];
  const tickVals = yDomain ? [domain[0], (domain[0] + domain[1]) / 2, domain[1]] : ticks(domain[1]);

  const plotW = Math.max(width - PAD.l - PAD.r, 1);
  const plotH = height - PAD.t - PAD.b;
  const xAt = (i: number) => (n === 1 ? PAD.l + plotW / 2 : PAD.l + (i * plotW) / (n - 1));
  const yScale = scaleLinear(domain, [PAD.t + plotH, PAD.t]);
  const yAt = (v: number) => yScale(Math.min(Math.max(v, domain[0]), domain[1]));

  const seg = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, k) => `${k === 0 ? 'M' : 'L'}${xAt(from + k)},${yAt(p.y)}`)
      .join(' ');
  const dotted = inProgressFrom !== undefined && inProgressFrom >= 1 && inProgressFrom <= last;
  const solidEnd = dotted ? inProgressFrom - 1 : last;

  const move = (delta: number | 'start' | 'end') =>
    setActive((a) => {
      if (delta === 'start') return 0;
      if (delta === 'end') return last;
      return Math.min(Math.max((a ?? (delta > 0 ? -1 : last + 1)) + delta, 0), last);
    });
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number | 'start' | 'end'> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: 'start',
      End: 'end',
    };
    if (e.key === 'Escape') return setActive(null);
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    move(d);
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) * (r.width ? width / r.width : 1);
    setActive(
      nearestIndex(
        x,
        drawn.map((_, i) => xAt(i)),
      ),
    );
  };

  const marked = new Set(labelled.filter((i) => i >= 0 && i <= last));
  if (currentIndex !== undefined && currentIndex <= last) marked.add(currentIndex);
  if (active !== null) marked.add(active);
  const act = active !== null ? points[active] : undefined;

  return (
    <div ref={wrap} className={cn('relative w-full', className)}>
      <svg
        role="img"
        aria-label={label}
        aria-describedby={act ? tipId : undefined}
        tabIndex={0}
        width={width}
        height={height}
        className="block w-full rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onKeyDown={onKey}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {tickVals.map((t, ti) => (
          <g key={ti}>
            <line
              x1={PAD.l}
              x2={width - PAD.r}
              y1={yAt(t)}
              y2={yAt(t)}
              className="stroke-border-subtle"
              strokeWidth={1}
            />
            <text
              x={PAD.l - 8}
              y={yAt(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-current text-caption text-text-secondary"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}

        {target && (
          <>
            <line
              data-target
              x1={PAD.l}
              x2={width - PAD.r}
              y1={yAt(target.value)}
              y2={yAt(target.value)}
              className="stroke-text-secondary"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={width - PAD.r}
              y={yAt(target.value) - 4}
              textAnchor="end"
              className="fill-current text-caption text-text-secondary"
            >
              {target.label}
            </text>
          </>
        )}

        {act && active !== null && (
          <line
            x1={xAt(active)}
            x2={xAt(active)}
            y1={PAD.t}
            y2={PAD.t + plotH}
            className="stroke-border"
            strokeWidth={1}
          />
        )}

        <path
          data-series
          d={seg(0, solidEnd)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className={STROKE[color]}
        />
        {dotted && (
          <path
            data-series
            d={seg(inProgressFrom - 1, inProgressFrom)}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="1 5"
            className={STROKE[color]}
          />
        )}

        {points.map((p, i) => (
          <text
            key={i}
            data-x-label={i}
            x={xAt(i)}
            y={height - 8}
            textAnchor="middle"
            className={cn(
              'fill-current text-caption',
              i > last
                ? 'text-muted-foreground/50'
                : i === currentIndex
                  ? 'font-semibold text-foreground'
                  : 'text-text-secondary',
            )}
          >
            {p.x}
          </text>
        ))}

        {[...marked].map((i) => (
          <circle
            key={i}
            data-index={i}
            cx={xAt(i)}
            cy={yAt(points[i]!.y)}
            r={4}
            strokeWidth={2}
            className={cn(FILL[color], 'stroke-card')}
          />
        ))}
        {labelled
          .filter((i) => i >= 0 && i <= last)
          .map((i) => {
            const y = yAt(points[i]!.y);
            const below = y < PAD.t + 12;
            return (
              <text
                key={i}
                x={xAt(i)}
                y={below ? y + 20 : y - 10}
                textAnchor="middle"
                className="fill-current text-caption font-medium text-foreground"
              >
                {points[i]!.valueLabel}
              </text>
            );
          })}
      </svg>

      {act && active !== null && (
        <div
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md bg-popover px-2 py-1 text-caption whitespace-nowrap text-popover-foreground shadow-e2"
          // ponytail: fixed 48px edge margin, not measured; measure the tooltip if labels get long
          style={{ left: Math.min(Math.max(xAt(active), 48), width - 48), top: yAt(act.y) - 10 }}
        >
          {tooltipLabel(act)}
        </div>
      )}
    </div>
  );
}
