import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { cn } from '../../primitives/lib/utils';

import { BG, FILL, scaleLinear, ticks, type ChartColor } from './chart-utils';

export interface ColumnSeries {
  id: string;
  label: string;
  color: ChartColor;
}
export interface ColumnDatum {
  x: string;
  values: Record<string, number>;
  valueLabels: Record<string, string>;
  totalLabel?: string;
}
export interface ColumnChartProps {
  /** Accessible name: a summary sentence. */
  label: string;
  /** 1 = simple columns; 2+ = stacked, bottom to top in array order. */
  series: ColumnSeries[];
  data: ColumnDatum[];
  formatTick: (n: number) => string;
  /** Single series only: this column uses the series colour, the rest are muted. */
  highlightIndex?: number;
  /** Columns that get a value label (total, or each segment when stacked). */
  labelled?: number[];
  /** Column whose x label is bold. */
  currentIndex?: number;
  legend?: boolean;
  tooltipLabel?: (d: ColumnDatum) => string;
  height?: number;
  className?: string;
}

const ML = 44;
const MR = 8;
const MT = 20;
const MB = 24;
const GAP = 2;
const RADIUS = 4;

/** Rounded top corners only, anchored to the baseline. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.max(0, Math.min(RADIUS, w / 2, h));
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

export function ColumnChart({
  label,
  series,
  data,
  formatTick,
  highlightIndex,
  labelled = [],
  currentIndex,
  legend = series.length >= 2,
  tooltipLabel,
  height = 240,
  className,
}: ColumnChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stacked = series.length >= 2;
  const total = (d: ColumnDatum) => series.reduce((s, k) => s + (d.values[k.id] ?? 0), 0);
  const max = Math.max(0, ...data.map(total));
  const tk = ticks(max);
  const top = tk[tk.length - 1]!;
  const plotH = height - MT - MB;
  const y = scaleLinear([0, top], [MT + plotH, MT]);
  const slot = data.length ? (width - ML - MR) / data.length : 0;
  const bw = Math.max(1, Math.min(slot - GAP, 56));

  const defaultTip = (d: ColumnDatum) =>
    `${d.x}: ${series.map((k) => `${k.label} ${d.valueLabels[k.id] ?? ''}`).join(', ')}`;
  const tip = (d: ColumnDatum) => (tooltipLabel ?? defaultTip)(d);

  const onKey = (e: KeyboardEvent) => {
    if (!data.length) return;
    const cur = active ?? -1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(data.length - 1, cur + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, cur === -1 ? 0 : cur - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? data.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - ML) / slot);
    setActive(i >= 0 && i < data.length ? i : null);
  };

  return (
    <div ref={wrap} className={cn('w-full', className)}>
      <svg
        role="img"
        aria-label={label}
        tabIndex={0}
        width={width}
        height={height}
        onKeyDown={onKey}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(null)}
        className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tk.map((t) => (
          <g key={t}>
            <line
              x1={ML}
              x2={width - MR}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              data-tick
              x={ML - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-text-secondary text-xs"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        {active !== null && (
          <rect
            x={ML + active * slot}
            y={MT}
            width={slot}
            height={plotH}
            className="pointer-events-none fill-muted-foreground/10"
          />
        )}
        {data.map((d, i) => {
          const x = ML + i * slot + (slot - bw) / 2;
          const cx = x + bw / 2;
          const shown = labelled.includes(i);
          let acc = 0;
          const live = series.filter((k) => (d.values[k.id] ?? 0) > 0);
          const topId = live[live.length - 1]?.id;
          return (
            <g key={d.x}>
              {live.map((k, si) => {
                const v = d.values[k.id]!;
                const y1 = y(acc + v);
                const y0 = y(acc);
                acc += v;
                // 2px surface gap between stacked segments (trim the lower edge of upper ones)
                const h = Math.max(0, y0 - y1 - (si > 0 ? GAP : 0));
                const color: ChartColor = stacked
                  ? k.color
                  : highlightIndex === undefined || highlightIndex === i
                    ? k.color
                    : 'muted';
                const common = {
                  'data-segment': '',
                  'data-h': h,
                  className: FILL[color],
                };
                return (
                  <g key={k.id}>
                    {k.id === topId ? (
                      <path {...common} d={topRounded(x, y1, bw, h)} />
                    ) : (
                      <rect {...common} x={x} y={y1} width={bw} height={h} />
                    )}
                    {shown && stacked && h >= 14 && (
                      <text
                        data-value-label
                        x={cx}
                        y={y1 + h / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-text-primary stroke-background text-xs [paint-order:stroke]"
                        strokeWidth={3}
                      >
                        {d.valueLabels[k.id]}
                      </text>
                    )}
                  </g>
                );
              })}
              {shown && (!stacked || d.totalLabel) && (
                <text
                  data-value-label
                  x={cx}
                  y={y(acc) - 6}
                  textAnchor="middle"
                  className="fill-text-primary text-xs font-medium"
                >
                  {stacked ? d.totalLabel : d.valueLabels[series[0]!.id]}
                </text>
              )}
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                className={cn(
                  'fill-text-secondary text-xs',
                  currentIndex === i && 'fill-text-primary font-bold',
                )}
              >
                {d.x}
              </text>
            </g>
          );
        })}
      </svg>
      <div role="status" className="min-h-5 text-sm text-text-primary">
        {active !== null && data[active] ? tip(data[active]) : ''}
      </div>
      {legend && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-primary">
          {series.map((k) => (
            <li key={k.id} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-3 rounded-sm', BG[k.color])} />
              {k.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
