import type { EntityManager } from 'typeorm';
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

// The save step follows the same rule: when another column changes, a null
// attribution must not overwrite the stored user.
describe('marks / mark_grids upsert: null attribution keeps existing', () => {
  const m = { save: async (_e: unknown, x: unknown) => x } as unknown as EntityManager;

  it('marks.entered_by survives a value change', async () => {
    const existing = Object.assign(new Mark(), { id: ID, value: '5.00', entered_by: USER });
    const row = {
      exam_id: ID,
      student_id: ID,
      subject_id: ID,
      component_id: ID,
      value: '7.00',
      status: 'PRESENT',
      entered_by: null,
    } as unknown as MarkRow;
    const saved = await marksTab.upsert(row, existing, ID, m);
    expect(saved.value).toBe('7.00');
    expect(saved.entered_by).toBe(USER);
    // A named user still replaces it; a new row with no user stays null.
    expect((await marksTab.upsert({ ...row, entered_by: ID }, existing, ID, m)).entered_by).toBe(
      ID,
    );
    expect((await marksTab.upsert(row, null, ID, m)).entered_by).toBeNull();
  });

  it('mark_grids.submitted_by survives a state change', async () => {
    const existing = Object.assign(new MarkGrid(), {
      id: ID,
      state: 'DRAFT',
      submitted_by: USER,
    });
    const row = {
      exam_id: ID,
      section_id: ID,
      subject_id: ID,
      state: 'SUBMITTED',
      submitted_by: null,
      submitted_at: null,
    } as unknown as MarkGridRow;
    const saved = await markGridsTab.upsert(row, existing, ID, m);
    expect(saved.state).toBe('SUBMITTED');
    expect(saved.submitted_by).toBe(USER);
    expect((await markGridsTab.upsert(row, null, ID, m)).submitted_by).toBeNull();
  });
});
