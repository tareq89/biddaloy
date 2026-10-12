import { describe, expect, it } from 'vitest';
import { Mark } from '../../../exams/entities/mark.entity';
import { MarkGrid } from '../../../exams/entities/mark-grid.entity';
import { markGridsTab, type MarkGridRow } from './mark-grids.tab';
import { marksTab, type MarkRow } from './marks.tab';

const USER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ID = '11111111-1111-4111-8111-111111111111';

// A null attribution on the row means the export could not name the user
// (departed teacher / SUPER_ADMIN), so a same-tenant re-restore must not
// report it as a change.
describe('marks / mark_grids diffFields: null attribution keeps existing', () => {
  it('marks.entered_by', () => {
    const existing = Object.assign(new Mark(), {
      exam_id: ID,
      student_id: ID,
      subject_id: ID,
      component_id: ID,
      value: '5.00',
      status: 'PRESENT',
      entered_by: USER,
    });
    const row = {
      exam_id: ID,
      student_id: ID,
      subject_id: ID,
      component_id: ID,
      value: '5.00',
      status: 'PRESENT',
      entered_by: null,
    } as unknown as MarkRow;
    expect(marksTab.diffFields(row, existing)).toEqual([]);
    expect(marksTab.diffFields({ ...row, entered_by: ID }, existing)).toEqual(['entered_by']);
  });

  it('mark_grids.submitted_by', () => {
    const existing = Object.assign(new MarkGrid(), {
      exam_id: ID,
      section_id: ID,
      subject_id: ID,
      state: 'DRAFT',
      submitted_by: USER,
      submitted_at: null,
    });
    const row = {
      exam_id: ID,
      section_id: ID,
      subject_id: ID,
      state: 'DRAFT',
      submitted_by: null,
      submitted_at: null,
    } as unknown as MarkGridRow;
    expect(markGridsTab.diffFields(row, existing)).toEqual([]);
    expect(markGridsTab.diffFields({ ...row, submitted_by: ID }, existing)).toEqual([
      'submitted_by',
    ]);
  });
});
