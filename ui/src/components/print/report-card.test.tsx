import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IssuerSnapshot } from './issuer-header';
import { ReportCard, type ReportCardData } from './report-card';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

const LABELS = {
  examLabel: 'Exam',
  rollLabel: 'Roll',
  subject: 'Subject',
  obtained: 'Obtained',
  grade: 'Grade',
  gpa: 'GPA',
  totalMarks: 'Total marks',
  totalGpa: 'Total GPA',
  overallGrade: 'Overall grade',
  position: 'Position',
  positionValue: '{{position}}',
  fail: 'Fail',
  fourthSubject: '4th',
  absent: 'Absent',
  legendTitle: 'Grade legend',
  programs: 'Programs',
  progress: 'Progress',
  latestMilestone: 'Latest milestone',
  scoreGrade: 'Score/Grade',
};

const BASE: ReportCardData = {
  exam_name: 'Half Yearly 2026',
  student: { full_name: 'Rahim Ahmed', roll_number: 5 },
  result: { total_marks: 450, gpa: 4.5, grade: 'A', position: 2, is_fail: false },
  subjects: [
    {
      subject_name: 'Mathematics',
      obtained: 85,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      is_fourth_subject: false,
      components: [{ name: 'Written', full_marks: 100, obtained: 85 }],
    },
  ],
  legend: [
    { grade: 'A+', gpa: 5, comment: 'Excellent' },
    { grade: 'F', gpa: 0, comment: 'Fail' },
  ],
};

const MATH_SUBJECT = BASE.subjects[0]!;

describe('ReportCard', () => {
  it('renders a pass result with student identity and subject total', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Mathematics')).toBeTruthy();
    expect(screen.getAllByText('85 / 100').length).toBe(2);
    expect(screen.queryByText('Fail')).toBeNull();
  });

  it('renders a fail result with the fail badge and subject in destructive styling', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          result: { ...BASE.result, grade: 'F', gpa: 0, is_fail: true },
          subjects: [{ ...MATH_SUBJECT, grade: 'F', gpa: 0, is_fail: true }],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Fail')).toBeTruthy();
  });

  it('renders an absent subject component as "Absent", not a zero', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          subjects: [
            {
              ...MATH_SUBJECT,
              components: [{ name: 'Written', full_marks: 100, obtained: null }],
            },
          ],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/Absent/)).toBeTruthy();
  });

  it('marks a fourth subject with the 4th-subject badge', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          subjects: [{ ...MATH_SUBJECT, is_fourth_subject: true }],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('(4th)')).toBeTruthy();
  });

  it('renders the grading scale legend', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.getByText(/Excellent/)).toBeTruthy();
  });

  it('hides the programs block when programs is empty or undefined', () => {
    render(<ReportCard data={BASE} issuer={ISSUER} labels={LABELS} />);
    expect(screen.queryByText('Programs')).toBeNull();

    render(<ReportCard data={{ ...BASE, programs: [] }} issuer={ISSUER} labels={LABELS} />);
    expect(screen.queryByText('Programs')).toBeNull();
  });

  it('renders a program row with name, progress, latest milestone and score', () => {
    render(
      <ReportCard
        data={{
          ...BASE,
          programs: [
            {
              program_name: 'Hifz Circle',
              achieved_count: 7,
              milestone_total: 30,
              latest: {
                milestone_name: 'Juz 5',
                achieved_on: '2026-03-01',
                score: 92.5,
                grade: 'A',
              },
            },
          ],
        }}
        issuer={ISSUER}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Hifz Circle')).toBeTruthy();
    expect(screen.getByText('7 / 30')).toBeTruthy();
    expect(screen.getByText(/Juz 5/)).toBeTruthy();
    expect(screen.getByText(/92\.5/)).toBeTruthy();
  });
});
