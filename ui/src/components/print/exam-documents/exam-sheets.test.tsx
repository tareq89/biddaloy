import { render as rtlRender, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../../../i18n/region-config';
import { RegionConfigProvider } from '../../../i18n/region-config-provider';
import type { IssuerSnapshot } from '../issuer-header';

import {
  BlankMarksSheet,
  ExamRoutineNotice,
  type MarksSheetPage,
  type RoutineRow,
} from './exam-sheets';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

const render = (ui: React.ReactElement, region = REGION_BD_EN) =>
  rtlRender(<RegionConfigProvider value={region}>{ui}</RegionConfigProvider>);

const page = (section: string, subject: string, comps = 1): MarksSheetPage => ({
  className: 'Class 6',
  section,
  subject,
  components:
    comps === 2
      ? [
          { name: 'CQ', fullMarks: 70 },
          { name: 'MCQ', fullMarks: 30 },
        ]
      : [{ name: 'Written', fullMarks: 100 }],
  students: [
    { roll: 1, name: 'Student 1' },
    { roll: 2, name: 'Student 2' },
  ],
});

const base = { issuer: ISSUER, examName: 'Half Yearly', printedOn: 'Printed 8 Oct' };
const MARKS = { roll: 'Roll', name: 'Name', total: 'Total', teacher: 'Class teacher' };
const ROUTINE = {
  title: 'Exam routine',
  date: 'Date',
  day: 'Day',
  subject: 'Subject',
  time: 'Time',
  headTeacher: 'Head teacher',
};

describe('BlankMarksSheet', () => {
  it('draws one page per section x subject (2 x 3 = 6) with unique titles', async () => {
    const pages = ['A', 'B'].flatMap((s) => ['Bangla', 'English', 'Maths'].map((x) => page(s, x)));
    const { container } = render(<BlankMarksSheet {...base} pages={pages} labels={MARKS} />);
    expect(container.querySelectorAll('[data-slot="a4-document"]')).toHaveLength(6);
    const titles = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(new Set(titles).size).toBe(6);
    expect(container.querySelector('style')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('gives 2 components 2 empty columns plus total, headers with full marks', () => {
    const { container } = render(
      <BlankMarksSheet {...base} pages={[page('A', 'Bangla', 2)]} labels={MARKS} />,
    );
    expect(container.querySelectorAll('thead th')).toHaveLength(5);
    expect(screen.getByText('CQ (70)')).toBeTruthy();
    expect(screen.getByText('MCQ (30)')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(container.querySelectorAll('tbody tr:first-child td:empty')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="a4-signature"]')).toHaveLength(1);
  });

  it('prints Bangla digits under bn', () => {
    render(
      <BlankMarksSheet {...base} pages={[page('A', 'Bangla', 2)]} labels={MARKS} />,
      REGION_BD_BN,
    );
    expect(screen.getByText('CQ (৭০)')).toBeTruthy();
    expect(screen.getByText('MCQ (৩০)')).toBeTruthy();
  });

  it('numbers pages within each subject, in Bangla digits under bn', () => {
    const pages = ['A', 'B'].flatMap((s) => ['Bangla', 'Maths'].map((x) => page(s, x)));
    const { container } = render(
      <BlankMarksSheet {...base} pages={pages} labels={MARKS} />,
      REGION_BD_BN,
    );
    const titles = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Half Yearly - Bangla - A (১)',
      'Half Yearly - Maths - A (১)',
      'Half Yearly - Bangla - B (২)',
      'Half Yearly - Maths - B (২)',
    ]);
    expect(container.querySelectorAll('tbody th[scope="row"]')).toHaveLength(8);
  });
});

describe('ExamRoutineNotice', () => {
  it('renders one row per sitting in order and one signature', async () => {
    const rows: RoutineRow[] = ['Bangla', 'English', 'Maths'].map((s, i) => ({
      date: `${18 + i} Oct`,
      day: 'Day',
      subject: s,
      time: '10:00 - 1:00',
    }));
    const { container } = render(
      <ExamRoutineNotice {...base} className="Class 6" rows={rows} labels={ROUTINE} />,
    );
    const subjects = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelectorAll('td')[2]!.textContent,
    );
    expect(subjects).toEqual(['Bangla', 'English', 'Maths']);
    const sigs = container.querySelectorAll('[data-slot="a4-signature"]');
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.textContent).toBe('Head teacher');
    expect(container.querySelectorAll('[data-slot="a4-document"]')).toHaveLength(1);
    // The title is printed once, by the A4 heading - no second standalone title line.
    expect(container.querySelector('h2')!.textContent).toBe('Half Yearly - Exam routine');
    expect(screen.queryByText('Exam routine')).toBeNull();
    await expect(container).toHaveNoViolations();
  });
});
