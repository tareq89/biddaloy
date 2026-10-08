/**
 * [48.3.07] Tabulation sheet and yearly transcript (D1, D26, D27): code-
 * rendered A4 documents inside `A4Document`. Pure like `seat-plan-sheets.tsx`:
 * already-shaped props, translated `labels` as props, only `useRegionConfig` +
 * `formatNumber` so Bangla digits print. Grades are never computed here, and a
 * failed grade is boxed with a border so it survives black-and-white printing.
 * No global `@media print` rule (#1322).
 */
import { useRegionConfig } from '../../../i18n/region-config-provider';
import { formatNumber } from '../../../utils/number';
import { A4Document } from '../a4-document';
import type { IssuerSnapshot } from '../issuer-header';

export interface TabulationSubject {
  id: string;
  name: string;
  fullMarks: number;
}

export interface TabulationCell {
  obtained: number | null;
  grade: string;
  isFail: boolean;
}

export interface TabulationRow {
  roll: number;
  name: string;
  /** A subject the student did not take is absent from the record. */
  cells: Record<string, TabulationCell | undefined>;
  total: number;
  gpa: number;
  grade: string;
  merit: number | null;
  isFail: boolean;
}

export interface TabulationSheetProps {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  examName: string;
  className: string;
  section: string;
  subjects: TabulationSubject[];
  rows: TabulationRow[];
  /** Pre-formatted from the grading scale. */
  legend: string;
  printedOn: string;
  labels: {
    title: string;
    roll: string;
    name: string;
    /** "Full marks" - the number is appended. */
    fullMarks: string;
    obtained: string;
    grade: string;
    total: string;
    gpa: string;
    merit: string;
    /** Pre-formatted, e.g. "This section: 44 sat · 40 passed · 4 failed". */
    summary: string;
    classTeacher: string;
    examController: string;
    headTeacher: string;
  };
}

export interface TranscriptExam {
  name: string;
  subjects: { name: string; obtained: number; grade: string; gpa: number; isFail: boolean }[];
  total: number;
  gpa: number;
  grade: string;
  position: number | null;
  /** The exam's overall result failed: its grade is boxed like a failed subject. */
  isFail?: boolean;
}

export interface YearlyTranscriptProps {
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  student: { name: string; roll: number; className: string; section: string };
  yearName: string;
  exams: TranscriptExam[];
  printedOn: string;
  labels: {
    title: string;
    roll: string;
    subject: string;
    obtained: string;
    grade: string;
    gpa: string;
    total: string;
    exam: string;
    position: string;
    classTeacher: string;
    headTeacher: string;
  };
}

const DASH = '—';
const th = 'border border-foreground px-1 py-0.5 text-center text-caption font-semibold';
const td = 'border border-border-subtle px-1 py-0.5 text-center text-caption';
const box = 'inline-block min-w-[1.5em] border border-foreground px-0.5 font-bold';

function Grade({ grade, fail }: { grade: string; fail: boolean }) {
  return fail ? <span className={box}>{grade}</span> : <>{grade}</>;
}

export function TabulationSheet({
  issuer,
  logoUrl,
  activeLanguage,
  examName,
  className,
  section,
  subjects,
  rows,
  legend,
  printedOn,
  labels,
}: TabulationSheetProps) {
  const config = useRegionConfig();
  const num = (n: number | null) => formatNumber(n, config);
  const gpa = (n: number) => formatNumber(n, config, { decimals: 2 });
  const where = [examName, className, section].join(' · ');
  return (
    <A4Document
      issuer={issuer}
      logoUrl={logoUrl ?? null}
      {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      title={`${labels.title} - ${where}`}
      orientation="landscape"
      signatures={[labels.classTeacher, labels.examController, labels.headTeacher]}
      printedOn={printedOn}
    >
      <table className="w-full border-collapse">
        <caption className="sr-only">{where}</caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className={th}>
              {labels.roll}
            </th>
            <th scope="col" rowSpan={2} className={`${th} text-start`}>
              {labels.name}
            </th>
            {subjects.map((s) => (
              <th key={s.id} scope="colgroup" colSpan={2} className={th}>
                {s.name}
                <br />
                {labels.fullMarks} {num(s.fullMarks)}
              </th>
            ))}
            {[labels.total, labels.gpa, labels.grade, labels.merit].map((h) => (
              <th key={h} scope="col" rowSpan={2} className={th}>
                {h}
              </th>
            ))}
          </tr>
          <tr>
            {subjects.flatMap((s) => [
              <th key={`${s.id}-o`} scope="col" className={th}>
                {labels.obtained}
              </th>,
              <th key={`${s.id}-g`} scope="col" className={th}>
                {labels.grade}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.roll}-${i}`}
              className={`print:break-inside-avoid ${r.isFail ? 'bg-muted [print-color-adjust:exact]' : ''}`}
            >
              <td className={td}>{num(r.roll)}</td>
              <th scope="row" className={`${td} text-start font-normal`}>
                {r.name}
              </th>
              {subjects.flatMap((s) => {
                const c = r.cells[s.id];
                return [
                  <td key={`${s.id}-o`} className={td}>
                    {c ? num(c.obtained) : DASH}
                  </td>,
                  <td key={`${s.id}-g`} className={td}>
                    {c ? <Grade grade={c.grade} fail={c.isFail} /> : DASH}
                  </td>,
                ];
              })}
              <td className={td}>{num(r.total)}</td>
              <td className={td}>{gpa(r.gpa)}</td>
              <td className={td}>
                <Grade grade={r.grade} fail={r.isFail} />
              </td>
              <td className={td}>{r.isFail || r.merit === null ? DASH : num(r.merit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between gap-4 text-caption">
        <span>{legend}</span>
        <span className="font-semibold">{labels.summary}</span>
      </div>
    </A4Document>
  );
}

const h = 'border-b border-foreground px-1 py-1 text-start font-semibold';
const c = 'border-b border-border-subtle px-1 py-0.5';

export function YearlyTranscript({
  issuer,
  logoUrl,
  activeLanguage,
  student,
  yearName,
  exams,
  printedOn,
  labels,
}: YearlyTranscriptProps) {
  const config = useRegionConfig();
  const num = (n: number | null) => formatNumber(n, config);
  const gpa = (n: number) => formatNumber(n, config, { decimals: 2 });
  const subtitle = [`${labels.roll} ${num(student.roll)}`, student.className, student.section].join(
    ' · ',
  );
  return (
    <A4Document
      issuer={issuer}
      logoUrl={logoUrl ?? null}
      {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      title={`${labels.title} - ${student.name} (${yearName})`}
      subtitle={subtitle}
      signatures={[labels.classTeacher, labels.headTeacher]}
      printedOn={printedOn}
    >
      {exams.map((e, i) => (
        <table key={`${i}-${e.name}`} className="w-full border-collapse print:break-inside-avoid">
          <caption className="pb-1 text-start font-semibold">{e.name}</caption>
          <thead>
            <tr>
              <th scope="col" className={h}>
                {labels.subject}
              </th>
              <th scope="col" className={`${h} text-end`}>
                {labels.obtained}
              </th>
              <th scope="col" className={h}>
                {labels.grade}
              </th>
              <th scope="col" className={h}>
                {labels.gpa}
              </th>
            </tr>
          </thead>
          <tbody>
            {e.subjects.map((s, j) => (
              <tr key={`${j}-${s.name}`}>
                <th scope="row" className={`${c} font-normal`}>
                  {s.name}
                </th>
                <td className={`${c} text-end`}>{num(s.obtained)}</td>
                <td className={c}>
                  <Grade grade={s.grade} fail={s.isFail} />
                </td>
                <td className={c}>{gpa(s.gpa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <table className="w-full border-collapse print:break-inside-avoid">
        <caption className="sr-only">{labels.title}</caption>
        <thead>
          <tr>
            {[labels.exam, labels.total, labels.gpa, labels.grade, labels.position].map((x) => (
              <th key={x} scope="col" className={h}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exams.map((e, i) => (
            <tr key={`${i}-${e.name}`}>
              <th scope="row" className={`${c} font-normal`}>
                {e.name}
              </th>
              <td className={c}>{num(e.total)}</td>
              <td className={c}>{gpa(e.gpa)}</td>
              <td className={c}>
                <Grade grade={e.grade} fail={!!e.isFail} />
              </td>
              <td className={c}>{e.position === null ? DASH : num(e.position)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </A4Document>
  );
}
