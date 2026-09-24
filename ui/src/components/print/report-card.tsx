/**
 * [19.8.1] The printable, bilingual report card — cloned from
 * `invoice-receipt.tsx`'s shape (D6): pure, hook-free (takes translated
 * `labels` as props, same reasoning as that file's own header comment —
 * usable from Storybook or a chrome-free route without an i18n provider),
 * fixed A4 width, `print:` Tailwind variants rather than a separate CSS
 * file (`invoice-receipt.tsx` has none either).
 *
 * `ResultSubject` never stores a per-component breakdown (only the
 * subject's `obtained` total) — `components` here comes from
 * `ResultsService.getStudentResult` joining `Mark`/`ExamComponent`
 * directly (see that method's own doc comment). A component with
 * `obtained: null` renders "Absent" rather than "0" — same ABSENT-vs-zero
 * distinction `result-rules.ts` enforces server-side.
 */
import * as React from 'react';

import { IssuerHeader, type IssuerSnapshot } from './issuer-header';

export interface ReportCardComponent {
  name: string;
  full_marks: number;
  obtained: number | null;
}

export interface ReportCardSubject {
  subject_name: string;
  obtained: number;
  grade: string;
  gpa: number;
  is_fail: boolean;
  is_fourth_subject: boolean;
  components: ReportCardComponent[];
}

export interface ReportCardLegendRow {
  grade: string;
  gpa: number | null;
  comment: string | null;
}

export interface ReportCardData {
  exam_name: string;
  student: { full_name: string; roll_number: number };
  result: {
    total_marks: number;
    gpa: number;
    grade: string;
    position: number | null;
    is_fail: boolean;
  };
  subjects: ReportCardSubject[];
  legend: ReportCardLegendRow[];
}

export interface ReportCardProps {
  data: ReportCardData;
  issuer: IssuerSnapshot;
  logoUrl?: string | null;
  activeLanguage?: string;
  labels: {
    examLabel: string;
    rollLabel: string;
    subject: string;
    obtained: string;
    grade: string;
    gpa: string;
    totalMarks: string;
    totalGpa: string;
    overallGrade: string;
    position: string;
    positionValue: string; // "{{position}}"
    fail: string;
    fourthSubject: string;
    absent: string;
    legendTitle: string;
  };
}

function subjectFullMarks(components: ReportCardComponent[]): number {
  return components.reduce((sum, c) => sum + c.full_marks, 0);
}

export function ReportCard({ data, issuer, logoUrl, activeLanguage, labels }: ReportCardProps) {
  return (
    <div
      data-slot="report-card"
      className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 text-sm print:gap-4"
    >
      <IssuerHeader
        issuer={issuer}
        logoUrl={logoUrl ?? null}
        {...(activeLanguage !== undefined ? { activeLanguage } : {})}
      />

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <span className="font-semibold">{data.exam_name}</span>
        {data.result.is_fail && (
          <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive">
            {labels.fail}
          </span>
        )}
      </div>

      <div className="flex justify-between gap-2">
        <span className="font-medium">{data.student.full_name}</span>
        <span className="text-muted-foreground">
          {labels.rollLabel}: {data.student.roll_number}
        </span>
      </div>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{labels.subject}</caption>
        <thead>
          <tr className="border-b text-start text-muted-foreground">
            <th className="py-1">{labels.subject}</th>
            <th className="py-1 text-end">{labels.obtained}</th>
            <th className="py-1">{labels.grade}</th>
            <th className="py-1">{labels.gpa}</th>
          </tr>
        </thead>
        <tbody>
          {data.subjects.map((subject) => (
            <React.Fragment key={subject.subject_name}>
              <tr className={subject.is_fail ? 'text-destructive' : undefined}>
                <td className="py-1 font-medium">
                  {subject.subject_name}
                  {subject.is_fourth_subject && (
                    <span className="ms-1 text-xs text-muted-foreground">
                      ({labels.fourthSubject})
                    </span>
                  )}
                </td>
                <td className="py-1 text-end">
                  {subject.obtained} / {subjectFullMarks(subject.components)}
                </td>
                <td className="py-1">{subject.grade}</td>
                <td className="py-1">{subject.gpa.toFixed(2)}</td>
              </tr>
              {subject.components.map((component) => (
                <tr key={component.name} className="text-xs text-muted-foreground">
                  <td className="py-0.5 ps-4">{component.name}</td>
                  <td className="py-0.5 text-end">
                    {component.obtained === null ? labels.absent : component.obtained} /{' '}
                    {component.full_marks}
                  </td>
                  <td />
                  <td />
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 font-semibold">
        <div className="flex justify-between gap-2">
          <span>{labels.totalMarks}</span>
          <span>{data.result.total_marks}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.totalGpa}</span>
          <span>{data.result.gpa.toFixed(2)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.overallGrade}</span>
          <span>{data.result.grade}</span>
        </div>
        {data.result.position !== null && (
          <div className="flex justify-between gap-2">
            <span>{labels.position}</span>
            <span>{data.result.position}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-muted-foreground">
        <div className="font-medium">{labels.legendTitle}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.legend.map((band) => (
            <span key={band.grade}>
              {band.grade}
              {band.gpa !== null ? ` (${band.gpa.toFixed(2)})` : ''}
              {band.comment ? ` — ${band.comment}` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
