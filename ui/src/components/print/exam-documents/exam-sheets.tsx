/**
 * [48.3.06] Blank marks sheet and exam routine notice (D1, D21, D26): code-
 * rendered A4 documents inside `A4Document`. Pure like `seat-plan-sheets.tsx`:
 * already-shaped props, translated `labels` as props, only `useRegionConfig` +
 * `formatNumber` so Bangla digits print. No global `@media print` rule (#1322).
 */
import { useRegionConfig } from '../../../i18n/region-config-provider';
import { formatNumber } from '../../../utils/number';
import { A4Document } from '../a4-document';
import type { IssuerSnapshot } from '../issuer-header';

export interface MarksSheetPage {
  className: string;
  section: string;
  subject: string;
  /** e.g. CQ 70, MCQ 30 */
  components: { name: string; fullMarks: number }[];
  /** Sorted by roll by the caller. */
  students: { roll: number | null; name: string }[];
}

export interface BlankMarksSheetProps {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  examName: string;
  printedOn: string;
  pages: MarksSheetPage[];
  labels: { roll: string; name: string; total: string; teacher: string };
}

/** All pre-formatted by the caller. */
export interface RoutineRow {
  date: string;
  day: string;
  subject: string;
  time: string;
}

export interface ExamRoutineNoticeProps {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  examName: string;
  className: string;
  rows: RoutineRow[];
  printedOn: string;
  labels: {
    title: string;
    date: string;
    day: string;
    subject: string;
    time: string;
    headTeacher: string;
  };
}

const th = 'border-b border-foreground px-1 py-1 text-start font-semibold';
const td = 'border-b border-border-subtle px-1 py-0.5';
const blank = `${td} border-s border-border-subtle`;
/** Row header: reads like a cell on paper, announced as the row's name by a screen reader. */
const rowTh = `${td} text-start font-normal`;

export function BlankMarksSheet({
  issuer,
  logoUrl,
  activeLanguage,
  examName,
  printedOn,
  pages,
  labels,
}: BlankMarksSheetProps) {
  const config = useRegionConfig();
  const num = (n: number | null) => formatNumber(n, config);
  // Pages are numbered within each subject's pile (1, 2, … per class + subject).
  const seen = new Map<string, number>();
  return (
    <>
      {pages.map((p, i) => {
        const where = [p.className, p.section, p.subject].join(' · ');
        const pile = `${p.className}\u0000${p.subject}`;
        const n = (seen.get(pile) ?? 0) + 1;
        seen.set(pile, n);
        return (
          <A4Document
            key={`${p.className}-${p.section}-${p.subject}-${i}`}
            issuer={issuer}
            logoUrl={logoUrl ?? null}
            {...(activeLanguage !== undefined ? { activeLanguage } : {})}
            title={`${examName} - ${p.subject} - ${p.section} (${num(n)})`}
            subtitle={where}
            signatures={[labels.teacher]}
            printedOn={printedOn}
          >
            <table className="w-full border-collapse">
              <caption className="sr-only">{where}</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    {labels.roll}
                  </th>
                  <th scope="col" className={th}>
                    {labels.name}
                  </th>
                  {p.components.map((c, ci) => (
                    <th
                      key={`${ci}-${c.name}`}
                      scope="col"
                      className={`${th} w-24 border-s border-border-subtle`}
                    >
                      {c.name} ({num(c.fullMarks)})
                    </th>
                  ))}
                  <th scope="col" className={`${th} w-24 border-s border-border-subtle`}>
                    {labels.total}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.students.map((s, r) => (
                  <tr key={`${s.roll}-${r}`} className="h-[9mm] print:break-inside-avoid">
                    <td className={td}>{num(s.roll)}</td>
                    <th scope="row" className={rowTh}>
                      {s.name}
                    </th>
                    {p.components.map((c, ci) => (
                      <td key={`${ci}-${c.name}`} className={blank} />
                    ))}
                    <td className={blank} />
                  </tr>
                ))}
              </tbody>
            </table>
          </A4Document>
        );
      })}
    </>
  );
}

export function ExamRoutineNotice({
  issuer,
  logoUrl,
  activeLanguage,
  examName,
  className,
  rows,
  printedOn,
  labels,
}: ExamRoutineNoticeProps) {
  return (
    <A4Document
      issuer={issuer}
      logoUrl={logoUrl ?? null}
      {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      title={`${examName} - ${labels.title}`}
      subtitle={className}
      signatures={[labels.headTeacher]}
      printedOn={printedOn}
    >
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {labels.title} - {className}
        </caption>
        <thead>
          <tr>
            {[labels.date, labels.day, labels.subject, labels.time].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="h-[9mm] print:break-inside-avoid">
              <td className={td}>{r.date}</td>
              <td className={td}>{r.day}</td>
              <td className={td}>{r.subject}</td>
              <td className={td}>{r.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </A4Document>
  );
}
