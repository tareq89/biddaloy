/**
 * [48.3.05] Seat list, invigilator sheet and seat stickers (D1, D20): code-
 * rendered A4 documents built inside `A4Document`. Pure and hook-free like
 * `report-card.tsx`: already-shaped props (the client print page maps the
 * `SeatPlanDetail` API data), translated `labels` as props, only
 * `useRegionConfig` + `formatNumber` so Bangla digits print. `print:` variants
 * on own classes, no global `@media print` rule (#1322).
 */
import { useRegionConfig } from '../../../i18n/region-config-provider';
import { formatNumber } from '../../../utils/number';
import { A4Document } from '../a4-document';
import type { IssuerSnapshot } from '../issuer-header';

export interface SeatRow {
  seat: string;
  roll: number | null;
  name: string;
  section: string | null;
  className?: string;
}

export interface RoomSitting {
  room: string;
  /** Already formatted: date, subject and time span. */
  sitting: string;
  note?: string;
  invigilator?: string | null;
  /** Sorted by seat by the caller. */
  rows: SeatRow[];
}

interface SheetBase {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  examName: string;
  className?: string;
  printedOn: string;
  pages: RoomSitting[];
}

export interface SeatListSheetProps extends SheetBase {
  labels: {
    room: string;
    /** "Seats {{first}}–{{last}}" */
    seats: string;
    seat: string;
    roll: string;
    name: string;
    section: string;
    fromSeatPlan: string;
    /** "Page {{page}} / {{total}}" */
    pageOf: string;
  };
}

export interface InvigilatorSheetProps extends SheetBase {
  labels: {
    room: string;
    seat: string;
    roll: string;
    name: string;
    section: string;
    present: string;
    scriptNo: string;
    signature: string;
    invigilator: string;
  };
}

export interface SeatStickerSheetProps {
  issuer: IssuerSnapshot;
  stickers: Array<SeatRow & { room: string }>;
  perPage?: number;
  labels: { roll: string; room: string; seat: string };
}

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

const th = 'border-b border-foreground px-1 py-1 text-start font-semibold';
const td = 'border-b border-border-subtle px-1 py-0.5';
const blank = `${td} border-s border-border-subtle`;

function useFmt() {
  const config = useRegionConfig();
  return {
    num: (n: number | null) => formatNumber(n, config),
    /** Seat labels may be "A-3": only pure digits get number-formatted. */
    seat: (s: string) => (/^\d+$/.test(s) ? formatNumber(Number(s), config) : s),
  };
}

function Head({ cols, extra = [] }: { cols: string[]; extra?: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((h) => (
          <th key={h} scope="col" className={th}>
            {h}
          </th>
        ))}
        {extra.map((h) => (
          <th key={h} scope="col" className={`${th} w-24 border-s border-border-subtle`}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function SeatListSheet({
  issuer,
  logoUrl,
  activeLanguage,
  examName,
  className,
  printedOn,
  pages,
  labels,
}: SeatListSheetProps) {
  const { num, seat } = useFmt();
  const cols = [labels.seat, labels.roll, labels.name, labels.section];
  return (
    <>
      {pages.map((p, i) => {
        const half = Math.ceil(p.rows.length / 2);
        const tables = [p.rows.slice(0, half), p.rows.slice(half)].filter((c) => c.length > 0);
        const first = p.rows[0]?.seat ?? '';
        const last = p.rows[p.rows.length - 1]?.seat ?? '';
        return (
          <A4Document
            key={`${p.room}-${i}`}
            issuer={issuer}
            logoUrl={logoUrl ?? null}
            {...(activeLanguage !== undefined ? { activeLanguage } : {})}
            title={`${examName} - ${labels.room} ${p.room}`}
            {...(className ? { subtitle: className } : {})}
          >
            <div
              data-slot="seat-list-band"
              className="flex items-baseline justify-between bg-text-primary px-3 py-2 text-surface [print-color-adjust:exact] print:text-print-title"
            >
              <span className="font-bold">
                {labels.room} {p.room}
              </span>
              <span>{fill(labels.seats, { first: seat(first), last: seat(last) })}</span>
            </div>
            <div className="flex justify-between gap-4">
              <p>{p.sitting}</p>
              {p.note ? <p className="text-text-secondary">{p.note}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {tables.map((rows, c) => (
                <table key={c} className="w-full border-collapse">
                  <caption className="sr-only">
                    {labels.room} {p.room} - {p.sitting}
                  </caption>
                  <Head cols={cols} />
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.seat}>
                        <td className={td}>{seat(r.seat)}</td>
                        <td className={td}>{num(r.roll)}</td>
                        <td className={td}>{r.name}</td>
                        <td className={td}>{r.section ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
            <p className="mt-auto flex justify-between text-caption text-text-secondary">
              <span>
                {labels.fromSeatPlan} · {printedOn}
              </span>
              <span>{fill(labels.pageOf, { page: num(i + 1), total: num(pages.length) })}</span>
            </p>
          </A4Document>
        );
      })}
    </>
  );
}

export function InvigilatorSheet({
  issuer,
  logoUrl,
  activeLanguage,
  examName,
  className,
  printedOn,
  pages,
  labels,
}: InvigilatorSheetProps) {
  const { num, seat } = useFmt();
  return (
    <>
      {pages.map((p, i) => (
        <A4Document
          key={`${p.room}-${i}`}
          issuer={issuer}
          logoUrl={logoUrl ?? null}
          {...(activeLanguage !== undefined ? { activeLanguage } : {})}
          title={`${examName} - ${labels.room} ${p.room}`}
          subtitle={[
            className,
            p.sitting,
            p.invigilator ? `${labels.invigilator}: ${p.invigilator}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          signatures={[labels.invigilator]}
          printedOn={printedOn}
        >
          <table className="w-full border-collapse">
            <caption className="sr-only">
              {labels.room} {p.room} - {p.sitting}
            </caption>
            <Head
              cols={[labels.seat, labels.roll, labels.name, labels.section]}
              extra={[labels.present, labels.scriptNo, labels.signature]}
            />
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.seat} className="h-[9mm] print:break-inside-avoid">
                  <td className={td}>{seat(r.seat)}</td>
                  <td className={td}>{num(r.roll)}</td>
                  <td className={td}>{r.name}</td>
                  <td className={td}>{r.section ?? ''}</td>
                  <td className={blank} />
                  <td className={blank} />
                  <td className={blank} />
                </tr>
              ))}
            </tbody>
          </table>
        </A4Document>
      ))}
    </>
  );
}

export function SeatStickerSheet({
  issuer,
  stickers,
  perPage = 21,
  labels,
}: SeatStickerSheetProps) {
  const { num, seat } = useFmt();
  const chunks: Array<typeof stickers> = [];
  for (let i = 0; i < stickers.length; i += perPage) chunks.push(stickers.slice(i, i + perPage));
  return (
    <>
      {chunks.map((chunk, p) => (
        <div
          key={p}
          data-slot="seat-sticker-page"
          className="mx-auto grid w-full max-w-[189mm] grid-cols-[repeat(3,63mm)] content-start print:break-after-page print:last:break-after-auto"
        >
          {chunk.map((s) => (
            <div
              key={`${s.room}-${s.seat}`}
              data-slot="seat-sticker"
              className="flex h-[38mm] w-[63mm] flex-col justify-between overflow-hidden border border-dashed border-border-subtle p-2"
            >
              <p className="text-caption text-text-secondary">{issuer.name}</p>
              <p className="text-h2 print:text-print-title">
                <span className="sr-only">{labels.roll} </span>
                {num(s.roll)}
              </p>
              <p className="truncate font-semibold">{s.name}</p>
              <p className="text-caption">{[s.className, s.section].filter(Boolean).join(' · ')}</p>
              <p className="text-caption">
                {labels.room} {s.room} · {labels.seat} {seat(s.seat)}
              </p>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
