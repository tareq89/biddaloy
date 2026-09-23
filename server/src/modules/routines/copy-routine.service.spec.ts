import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { CopyRoutineService } from './copy-routine.service';

const TENANT_ID = 'tenant-1';

const SOURCE_YEAR = {
  id: 'year-1',
  tenant_id: TENANT_ID,
  deleted_at: null,
  start_date: '2025-01-01',
  end_date: '2025-12-31',
};

function buildService(overrides: {
  sourceYear?: any;
  targetYear?: any;
  existingTargetRoutine?: any;
  sourceSlots?: any[];
  sourceSections?: any[];
  sourceClasses?: any[];
  targetClasses?: any[];
  targetSections?: any[];
  subjects?: any[];
  teacherRows?: any[];
  tcsRows?: any[];
}) {
  const source = {
    id: 'routine-src',
    tenant_id: TENANT_ID,
    academic_year_id: SOURCE_YEAR.id,
    name: 'AY25 routine',
    deleted_at: null,
  };
  const targetYear =
    'targetYear' in overrides
      ? overrides.targetYear
      : {
          id: 'year-2',
          tenant_id: TENANT_ID,
          deleted_at: null,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
        };

  const routineRepo: any = {
    findOne: vi.fn(async ({ where }: any) => {
      if (where.academic_year_id) return overrides.existingTargetRoutine ?? null;
      return source;
    }),
    create: vi.fn((v: any) => ({ id: 'routine-new', ...v })),
    save: vi.fn(async (v: any) => v),
  };
  const savedSlots: any[] = [];
  const slotRepo: any = {
    find: vi.fn(async () => overrides.sourceSlots ?? []),
    create: vi.fn((v: any) => ({ id: `slot-new-${savedSlots.length + 1}`, ...v })),
    save: vi.fn(async (v: any) => {
      savedSlots.push(v);
      return v;
    }),
  };
  const savedTeachers: any[] = [];
  const slotTeacherRepo: any = {
    find: vi.fn(async () => overrides.teacherRows ?? []),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => {
      savedTeachers.push(...(Array.isArray(v) ? v : [v]));
      return v;
    }),
  };
  const sourceYear = overrides.sourceYear ?? SOURCE_YEAR;
  const yearRepo: any = {
    findOne: vi.fn(async ({ where }: any) =>
      where.id === SOURCE_YEAR.id ? sourceYear : targetYear,
    ),
  };
  const sectionRepo: any = {
    find: vi.fn(async ({ where }: any) =>
      where.class_id ? (overrides.targetSections ?? []) : (overrides.sourceSections ?? []),
    ),
  };
  const classRepo: any = {
    find: vi.fn(async ({ where }: any) =>
      where.academic_year_id ? (overrides.targetClasses ?? []) : (overrides.sourceClasses ?? []),
    ),
  };
  const subjectRepo: any = { find: vi.fn(async () => overrides.subjects ?? []) };
  const tcsRepo: any = { find: vi.fn(async () => overrides.tcsRows ?? []) };
  const dataSource: any = {
    transaction: (cb: any) =>
      cb({
        getRepository: (entity: any) => {
          switch (entity?.name) {
            case 'Routine':
              return routineRepo;
            case 'RoutineSlot':
              return slotRepo;
            case 'RoutineSlotTeacher':
              return slotTeacherRepo;
            case 'TeacherClassSection':
              return tcsRepo;
            default:
              return routineRepo;
          }
        },
      }),
  };

  const service = new CopyRoutineService(
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    yearRepo,
    sectionRepo,
    classRepo,
    subjectRepo,
    tcsRepo,
    dataSource,
  );
  return { service, routineRepo, slotRepo, slotTeacherRepo, savedSlots, savedTeachers };
}

const SOURCE_SLOT = {
  id: 'slot-1',
  routine_id: 'routine-src',
  section_id: 'section-src',
  period_slot_id: 'period-1',
  weekday: 1,
  subject_id: 'subject-1',
  room_id: 'room-1',
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2025-01-01',
  valid_to: null,
};

describe('CopyRoutineService [21.6.1] D19', () => {
  it('lands the copy in DRAFT and maps section by class+section name, subject by id', async () => {
    const ctx = buildService({
      sourceSlots: [SOURCE_SLOT],
      sourceSections: [{ id: 'section-src', class_id: 'class-src', section_name: 'A' }],
      sourceClasses: [{ id: 'class-src', name: 'Class 6' }],
      targetClasses: [{ id: 'class-tgt', name: 'Class 6', academic_year_id: 'year-2' }],
      targetSections: [{ id: 'section-tgt', class_id: 'class-tgt', section_name: 'A' }],
      subjects: [{ id: 'subject-1', code: 'MATH', deleted_at: null }],
    });

    const result = await ctx.service.copyToYear(
      'routine-src',
      { target_academic_year_id: 'year-2' },
      TENANT_ID,
    );

    expect(result.routine.state).toBe(RoutineState.DRAFT);
    expect(result.unmapped_sections).toEqual([]);
    expect(result.unmapped_subjects).toEqual([]);
    expect(result.skipped_slot_count).toBe(0);
    expect(ctx.savedSlots).toHaveLength(1);
    expect(ctx.savedSlots[0].section_id).toBe('section-tgt');
    expect(ctx.savedSlots[0].subject_id).toBe('subject-1');
  });

  it('reports (does not silently drop) a section it cannot map', async () => {
    const ctx = buildService({
      sourceSlots: [SOURCE_SLOT],
      sourceSections: [{ id: 'section-src', class_id: 'class-src', section_name: 'A' }],
      sourceClasses: [{ id: 'class-src', name: 'Class 6' }],
      targetClasses: [], // no matching class in target year at all
      subjects: [{ id: 'subject-1', code: 'MATH', deleted_at: null }],
    });

    const result = await ctx.service.copyToYear(
      'routine-src',
      { target_academic_year_id: 'year-2' },
      TENANT_ID,
    );

    expect(result.unmapped_sections).toEqual([
      { source_section_id: 'section-src', class_name: 'Class 6', section_name: 'A' },
    ]);
    expect(result.skipped_slot_count).toBe(1);
    expect(ctx.savedSlots).toHaveLength(0);
  });

  it('refuses to copy into a year that already has a routine', async () => {
    const ctx = buildService({ existingTargetRoutine: { id: 'other-routine' } });
    await expect(
      ctx.service.copyToYear('routine-src', { target_academic_year_id: 'year-2' }, TENANT_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('404s for an unknown target academic year', async () => {
    const ctx = buildService({ targetYear: null });
    await expect(
      ctx.service.copyToYear('routine-src', { target_academic_year_id: 'year-2' }, TENANT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('copies a teacher only when still assigned to the mapped section/subject in the target year', async () => {
    const ctx = buildService({
      sourceSlots: [SOURCE_SLOT],
      sourceSections: [{ id: 'section-src', class_id: 'class-src', section_name: 'A' }],
      sourceClasses: [{ id: 'class-src', name: 'Class 6' }],
      targetClasses: [{ id: 'class-tgt', name: 'Class 6', academic_year_id: 'year-2' }],
      targetSections: [{ id: 'section-tgt', class_id: 'class-tgt', section_name: 'A' }],
      subjects: [{ id: 'subject-1', code: 'MATH', deleted_at: null }],
      teacherRows: [
        { routine_slot_id: 'slot-1', teacher_id: 't-1' },
        { routine_slot_id: 'slot-1', teacher_id: 't-2' },
      ],
      // Only t-1 still holds the assignment in the target year.
      tcsRows: [{ teacher_id: 't-1', section_id: 'section-tgt', subject_id: 'subject-1' }],
    });

    await ctx.service.copyToYear('routine-src', { target_academic_year_id: 'year-2' }, TENANT_ID);

    expect(ctx.savedTeachers).toHaveLength(1);
    expect(ctx.savedTeachers[0].teacher_id).toBe('t-1');
  });

  it('clamps a remapped valid_to that overruns the target year end, instead of dropping the slot', async () => {
    // Source year is a real leap year (2024, 366 days), target is not
    // (365) — a slot valid through the very last day of the source year
    // maps past the target year's end by one day.
    const ctx = buildService({
      sourceYear: {
        id: 'year-1',
        tenant_id: TENANT_ID,
        deleted_at: null,
        start_date: '2024-01-01',
        end_date: '2024-12-31',
      },
      targetYear: {
        id: 'year-2',
        tenant_id: TENANT_ID,
        deleted_at: null,
        start_date: '2027-01-01',
        end_date: '2027-12-31',
      },
      sourceSlots: [{ ...SOURCE_SLOT, valid_from: '2024-01-01', valid_to: '2024-12-31' }],
      sourceSections: [{ id: 'section-src', class_id: 'class-src', section_name: 'A' }],
      sourceClasses: [{ id: 'class-src', name: 'Class 6' }],
      targetClasses: [{ id: 'class-tgt', name: 'Class 6', academic_year_id: 'year-2' }],
      targetSections: [{ id: 'section-tgt', class_id: 'class-tgt', section_name: 'A' }],
      subjects: [{ id: 'subject-1', code: 'MATH', deleted_at: null }],
    });

    const result = await ctx.service.copyToYear(
      'routine-src',
      { target_academic_year_id: 'year-2' },
      TENANT_ID,
    );

    expect(result.skipped_slot_count).toBe(0);
    expect(ctx.savedSlots).toHaveLength(1);
    expect(ctx.savedSlots[0].valid_to).toBe('2027-12-31');
  });

  it('does not collapse same-named classes that differ only by shift/version', async () => {
    // Two source classes named "Class 6" — one Morning/A, one Day/B — and
    // matching target classes. Without shift/version in the map key,
    // both would collide on the same `Map` entry.
    const morningSlot = { ...SOURCE_SLOT, id: 'slot-morning', section_id: 'section-morning' };
    const daySlot = { ...SOURCE_SLOT, id: 'slot-day', section_id: 'section-day' };
    const ctx = buildService({
      sourceSlots: [morningSlot, daySlot],
      sourceSections: [
        { id: 'section-morning', class_id: 'class-morning', section_name: 'A' },
        { id: 'section-day', class_id: 'class-day', section_name: 'A' },
      ],
      sourceClasses: [
        { id: 'class-morning', name: 'Class 6', shift: 'Morning', version: null },
        { id: 'class-day', name: 'Class 6', shift: 'Day', version: null },
      ],
      targetClasses: [
        {
          id: 'class-tgt-morning',
          name: 'Class 6',
          shift: 'Morning',
          version: null,
          academic_year_id: 'year-2',
        },
        {
          id: 'class-tgt-day',
          name: 'Class 6',
          shift: 'Day',
          version: null,
          academic_year_id: 'year-2',
        },
      ],
      targetSections: [
        { id: 'section-tgt-morning', class_id: 'class-tgt-morning', section_name: 'A' },
        { id: 'section-tgt-day', class_id: 'class-tgt-day', section_name: 'A' },
      ],
      subjects: [{ id: 'subject-1', code: 'MATH', deleted_at: null }],
    });

    const result = await ctx.service.copyToYear(
      'routine-src',
      { target_academic_year_id: 'year-2' },
      TENANT_ID,
    );

    expect(result.unmapped_sections).toEqual([]);
    expect(result.skipped_slot_count).toBe(0);
    expect(ctx.savedSlots).toHaveLength(2);
    const bySlotSection = new Map(ctx.savedSlots.map((s: any) => [s.section_id, s]));
    expect(new Set(ctx.savedSlots.map((s: any) => s.section_id))).toEqual(
      new Set(['section-tgt-morning', 'section-tgt-day']),
    );
    expect(bySlotSection.size).toBe(2);
  });
});
