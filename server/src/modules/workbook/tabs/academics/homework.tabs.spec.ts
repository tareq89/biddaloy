import { describe, expect, it, vi } from 'vitest';
import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import { homeworkTab } from './homework.tab';
import { homeworkSubmissionTab } from './homework-submission.tab';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const REFS: Record<string, Record<string, string>> = {
  classes: { 'Six|2026': 'c1' },
  subjects: { MATH: 's1' },
  homework_assignments: { 'a-key': 'a1' },
  students: { 'STU-1': 'st1' },
};

function ctx(): ImportContext & { warn: ReturnType<typeof vi.fn> } {
  return {
    tenantId: TENANT,
    ref: (t, key) => REFS[t]?.[key],
    warn: vi.fn<(e: RowError) => void>(),
  };
}

const homeworkCells = (attachments: unknown[]) => ({
  id: ID,
  title: 'Ch 1',
  description: '',
  class: 'Six|2026',
  subject: 'MATH',
  grading_mode: Object.values(HomeworkGradingMode)[0],
  attachments: JSON.stringify(attachments),
});

const submissionCells = (attachments: unknown[]) => ({
  id: ID,
  assignment: 'a-key',
  student: 'STU-1',
  status: Object.values(HomeworkSubmissionStatus)[0],
  marks: '',
  attachments: JSON.stringify(attachments),
});

// `folder` is a folder each tab accepts: homework-submission.service.ts uploads to
// `homework-submissions/`; teacher attachments have no upload code yet (#1012).
describe.each([
  [
    'homework',
    'homework',
    (a: unknown[], c: ImportContext) => homeworkTab.fromRow(homeworkCells(a), 2, c),
  ],
  [
    'homework_submissions',
    'homework-submissions',
    (a: unknown[], c: ImportContext) => homeworkSubmissionTab.fromRow(submissionCells(a), 2, c),
  ],
])('%s attachments (DATA-02)', (_tab, folder, run) => {
  it('rejects the row when an attachment key points outside tenants/', () => {
    const result = run([{ key: 'backups/db/x.dump.age', filename: 'x' }], ctx());
    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'attachments' });
  });

  it("rewrites another school's attachment key to this school and warns", () => {
    const c = ctx();
    const result = run([{ key: `tenants/other/${folder}/f.pdf`, filename: 'f.pdf' }], c);
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.attachments).toEqual([
      { key: `tenants/${TENANT}/${folder}/f.pdf`, filename: 'f.pdf' },
    ]);
    expect(c.warn).toHaveBeenCalled();
  });

  it('does not warn when a later attachment rejects the row', () => {
    const c = ctx();
    const result = run(
      [{ key: `tenants/other/${folder}/f.pdf` }, { key: 'backups/db/x.dump.age' }],
      c,
    );
    expect('errors' in result).toBe(true);
    expect(c.warn).not.toHaveBeenCalled();
  });

  it('accepts an empty attachments list', () => {
    const result = run([], ctx());
    expect('row' in result).toBe(true);
  });
});

it("homework_submissions rejects this school's own key outside homework-submissions/", () => {
  const result = homeworkSubmissionTab.fromRow(
    submissionCells([{ key: `tenants/${TENANT}/workbook-backups/full.xlsx` }]),
    2,
    ctx(),
  );
  expect('errors' in result).toBe(true);
});
