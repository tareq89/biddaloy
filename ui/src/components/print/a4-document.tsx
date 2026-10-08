/**
 * [48.1.04] The A4 frame every code-rendered exam document (seat list,
 * stickers, sheets, notice, tabulation, transcript) is built inside (D1).
 * Same shape as `report-card.tsx`: pure and hook-free, labels as props, `print:`
 * variants on its own classes, no separate CSS and no global `@media print`
 * rule (#1322 — a global rule blanks the next page).
 *
 * Tables in `children` should use `<table>` + `<thead>`; the browser repeats
 * `<thead>` on every printed page, so there is no JS pagination.
 */
import * as React from 'react';

import { IssuerHeader, type IssuerSnapshot } from './issuer-header';

export interface A4DocumentProps {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  title: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  /** Footer signature lines, e.g. ["শ্রেণি শিক্ষক", "প্রধান শিক্ষক"]. */
  signatures?: string[];
  /** Already formatted by the caller. */
  printedOn?: string;
  children: React.ReactNode;
}

export function A4Document({
  issuer,
  logoUrl,
  activeLanguage,
  title,
  subtitle,
  orientation = 'portrait',
  signatures,
  printedOn,
  children,
}: A4DocumentProps) {
  const titleId = React.useId();
  return (
    <section
      data-slot="a4-document"
      data-orientation={orientation}
      aria-labelledby={titleId}
      className={`mx-auto flex w-full flex-col gap-4 text-sm print:break-after-page ${
        orientation === 'landscape'
          ? 'max-w-[297mm] print:min-h-[210mm]'
          : 'max-w-[210mm] print:min-h-[297mm]'
      }`}
    >
      <IssuerHeader
        issuer={issuer}
        logoUrl={logoUrl ?? null}
        {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      />
      <div className="border-t border-border-subtle pt-2">
        <h2 id={titleId} className="text-h2">
          {title}
        </h2>
        {subtitle ? <p className="text-text-secondary">{subtitle}</p> : null}
      </div>
      {children}
      {signatures && signatures.length > 0 ? (
        <div className="mt-auto flex justify-between gap-8 pt-12">
          {signatures.map((label, i) => (
            <div
              key={`${i}-${label}`}
              data-slot="a4-signature"
              className="min-w-0 flex-1 border-t border-foreground pt-1 text-center"
            >
              {label}
            </div>
          ))}
        </div>
      ) : null}
      {printedOn ? <p className="text-end text-caption text-text-secondary">{printedOn}</p> : null}
    </section>
  );
}
