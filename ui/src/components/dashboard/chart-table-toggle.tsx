/**
 * [169] Contract rule: every chart has a text summary and a toggleable data
 * table. The chart stays a pure SVG; the widget wraps it in this. Strings
 * arrive translated and formatted.
 */
import { ChartLineIcon, Table2Icon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';

export interface ChartTableToggleProps {
  /** Visible sentence under the chart, e.g. "Lowest 86.8%, highest 91.8%". */
  summary: string;
  table: {
    caption: string;
    columns: string[];
    rows: string[][];
    /** Per column: right-align as a number. */
    numeric?: boolean[];
  };
  showTableLabel: string;
  showChartLabel: string;
  defaultView?: 'chart' | 'table';
  /** The chart. */
  children: React.ReactNode;
}

export function ChartTableToggle({
  summary,
  table,
  showTableLabel,
  showChartLabel,
  defaultView = 'chart',
  children,
}: ChartTableToggleProps) {
  const [view, setView] = React.useState(defaultView);
  const isTable = view === 'table';
  const Icon = isTable ? ChartLineIcon : Table2Icon;
  const numericClass = (i: number) =>
    table.numeric?.[i] ? 'text-right tabular-nums' : 'text-left';

  return (
    <figure className="flex flex-col gap-2">
      {isTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr className="border-b border-border-subtle">
                {table.columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn('px-2 py-1 text-label font-medium', numericClass(i))}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-b border-border-subtle last:border-0">
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th
                        key={i}
                        scope="row"
                        className={cn('px-2 py-1 font-normal', numericClass(i))}
                      >
                        {cell}
                      </th>
                    ) : (
                      <td key={i} className={cn('px-2 py-1', numericClass(i))}>
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-label text-muted-foreground">{summary}</span>
        <button
          type="button"
          onClick={() => setView(isTable ? 'chart' : 'table')}
          className="inline-flex h-11 items-center gap-2 rounded-md px-2 text-label focus-visible:ring-2 focus-visible:ring-ring md:h-8"
        >
          <Icon aria-hidden="true" className="size-4" />
          {isTable ? showChartLabel : showTableLabel}
        </button>
      </figcaption>
    </figure>
  );
}
