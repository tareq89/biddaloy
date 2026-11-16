import * as React from 'react';
import { createPortal } from 'react-dom';

import './print-sheet.css';

export interface PrintSheetData {
  school: string;
  title: string;
  subtitle: string;
  columns: { key: string; label: string; wide?: boolean }[];
  rows: Record<string, string>[];
}

/**
 * [71.5.01] A plain table printed by the browser (Epic 32: browser-only print). The catalogue
 * has one-row fields and templates cannot repeat rows, so lists and attendance sheets are not
 * templates. Mounts a hidden copy on `body`, opens the print dialog, and calls `onDone` after.
 */
export function PrintSheet({ data, onDone }: { data: PrintSheetData; onDone: () => void }) {
  React.useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', onDone);
    // Print once per mount; `onDone` is only the close callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="print-sheet-root">
      <h1>{data.school}</h1>
      <h2>{data.title}</h2>
      <p>{data.subtitle}</p>
      <table>
        <thead>
          <tr>
            {data.columns.map((c) => (
              <th key={c.key} className={c.wide ? 'wide' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              {data.columns.map((c) => (
                <td key={c.key}>{r[c.key] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}
