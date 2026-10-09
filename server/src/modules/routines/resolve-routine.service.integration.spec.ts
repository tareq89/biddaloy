import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';

/**
 * [31.3.7c] Each resolved slot carries its subject's English and Bangla
 * name, because families get 403 on `GET /subjects`. Real DB: the lookup is
 * tenant-scoped by hand and must still name a soft-deleted subject.
 * Routines/slots/subjects are wiped before every test, so they are
 * re-seeded in `beforeEach`; the 2041 academic year is a reference row.
 */
describe('ResolveRoutineService — subject names (integration)', () => {
  let dataSource: DataSource;
  let service: ResolveRoutineService;

  const TENANT_B = '00000000-0000-4000-8000-0000000007c3';
  const MONDAY = '2041-03-04'; // weekday 1
  let periodSlotId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResolveRoutineService,
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: [MONDAY] }) },
        },
      ],
      [],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    service = module.get(ResolveRoutineService);

    await dataSource
      .getRepository(School)
      .save({ id: TENANT_B, name: 'Resolve Other School', slug: 'resolve-other' });

    const yearRepo = dataSource.getRepository(AcademicYear);
    const existing = await yearRepo.findOne({
      where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names 2041' },
    });
    if (!existing) {
      await yearRepo.save({
        tenant_id: SEED_TENANT_ID,
        name: 'Resolve Names 2041',
        start_date: '2041-01-01',
        end_date: '2041-12-31',
        is_current: false,
      });
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const year = await dataSource
      .getRepository(AcademicYear)
      .findOneOrFail({ where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names 2041' } });
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `Resolve-${Math.random().toString(36).slice(2, 8)}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    periodSlotId = (
      await dataSource.getRepository(PeriodSlot).save({
        tenant_id: SEED_TENANT_ID,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      })
    ).id;
    await dataSource.getRepository(Routine).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: year.id,
      name: 'Resolve Names Routine',
      state: RoutineState.PUBLISHED,
      published_at: new Date(),
    });
  });

  async function addSlot(subjectId: string): Promise<void> {
    const routine = await dataSource
      .getRepository(Routine)
      .findOneOrFail({ where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names Routine' } });
    await dataSource.getRepository(RoutineSlot).save({
      tenant_id: SEED_TENANT_ID,
      routine_id: routine.id,
      section_id: SEED_SECTION_1_ID,
      period_slot_id: periodSlotId,
      weekday: 1,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2041-01-01',
      valid_to: null,
    });
  }

  const resolve = () =>
    service.resolveRoutine(
      { section_id: SEED_SECTION_1_ID, from: MONDAY, to: MONDAY } as never,
      SEED_TENANT_ID,
      {
        role: 'ADMIN',
        userId: 'unused',
      },
    );

  const subjectRepo = () => dataSource.getRepository(Subject);

  it('names the slot subject in English and Bangla', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Science',
      name_bn: 'বিজ্ঞান',
      code: 'RSV-S',
    });
    await addSlot(subject.id);

    const slots = await resolve();

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ subject_name_en: 'Science', subject_name_bn: 'বিজ্ঞান' });
  });

  it('still names a soft-deleted subject', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Drawing',
      name_bn: 'চারুকলা',
      code: 'RSV-D',
    });
    await addSlot(subject.id);
    await subjectRepo().softDelete({ id: subject.id });

    const slots = await resolve();

    expect(slots[0]).toMatchObject({ subject_name_en: 'Drawing', subject_name_bn: 'চারুকলা' });
  });

  it("never names another tenant's subject", async () => {
    const foreign = await subjectRepo().save({
      tenant_id: TENANT_B,
      name_en: 'Secret',
      name_bn: 'গোপন',
      code: 'RSV-X',
    });
    await addSlot(foreign.id);

    const slots = await resolve();

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ subject_name_en: null, subject_name_bn: null });
  });
});
