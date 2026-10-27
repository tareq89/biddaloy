import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  LessonDeliveryStatus,
  PeriodSlotKind,
  RoutineState,
  SlotRecurrence,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { PeriodSlotsService } from './period-slots.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { LessonDelivery } from '../study-plans/entities/lesson-delivery.entity';

/**
 * [2893] replaceForShift against real Postgres: times change in place (same
 * ids) while periods are used; only removing / breaking a used row is refused;
 * renumbering must not trip the (shift_id, sequence) unique index.
 */
describe('PeriodSlotsService.replaceForShift (integration) [2893]', () => {
  let service: PeriodSlotsService;
  let ds: DataSource;
  const TENANT = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PeriodSlotsService,
        { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(PeriodSlotsService);
    ds = module.get<DataSource>(getDataSourceToken());
    await ds.getRepository(School).save({ id: TENANT, name: 'T', slug: 'test-school' });
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  /** Shift with periods 1-3 (sequence 0-2), a routine slot on #2, a delivery on #3. */
  async function seed(suffix: string) {
    const shift = await ds.getRepository(Shift).save({
      tenant_id: TENANT,
      name: `S-${suffix}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    const periods: PeriodSlot[] = [];
    for (const [i, start] of ['08:00:00', '09:00:00', '10:00:00'].entries()) {
      periods.push(
        await ds.getRepository(PeriodSlot).save({
          tenant_id: TENANT,
          shift_id: shift.id,
          sequence: i,
          kind: PeriodSlotKind.CLASS,
          starts_at: start,
          ends_at: `${start.slice(0, 2)}:40:00`,
        }),
      );
    }
    const year = await ds.getRepository(AcademicYear).save({
      tenant_id: TENANT,
      name: `Y-${suffix}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: false,
    });
    const klass = await ds.getRepository(Class).save({
      tenant_id: TENANT,
      academic_year_id: year.id,
      name: `C-${suffix}`,
      shift_id: shift.id,
    });
    const section = await ds
      .getRepository(ClassSection)
      .save({ tenant_id: TENANT, class_id: klass.id, section_name: 'A' });
    const subject = await ds
      .getRepository(Subject)
      .save({ tenant_id: TENANT, name_en: `Sub-${suffix}`, code: `S-${suffix}` });
    const routine = await ds.getRepository(Routine).save({
      tenant_id: TENANT,
      academic_year_id: year.id,
      name: `R-${suffix}`,
      state: RoutineState.DRAFT,
      published_at: null,
    });
    const routineSlot = await ds.getRepository(RoutineSlot).save({
      tenant_id: TENANT,
      routine_id: routine.id,
      section_id: section.id,
      period_slot_id: periods[1].id,
      weekday: 1,
      subject_id: subject.id,
      room_id: null,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2026-01-01',
      valid_to: null,
    });
    await ds.getRepository(LessonDelivery).save({
      tenant_id: TENANT,
      section_id: section.id,
      subject_id: subject.id,
      date: '2026-02-02',
      period_slot_id: periods[2].id,
      status: Object.values(LessonDeliveryStatus)[0],
    });
    return { shift, periods, routineSlot };
  }

  const item = (p: PeriodSlot, sequence: number, starts: string, ends: string) => ({
    id: p.id,
    sequence,
    kind: PeriodSlotKind.CLASS,
    starts_at: starts,
    ends_at: ends,
  });

  it('changes every time keeping ids, and the routine slot keeps its period', async () => {
    const { shift, periods, routineSlot } = await seed('a');
    const result = await service.replaceForShift(
      shift.id,
      {
        slots: [
          item(periods[0], 0, '08:10', '08:50'),
          item(periods[1], 1, '09:10', '09:50'),
          item(periods[2], 2, '10:10', '10:50'),
        ],
      } as any,
      TENANT,
    );
    expect(result.map((r) => r.id)).toEqual(periods.map((p) => p.id));
    expect(result[1].starts_at).toMatch(/^09:10/);
    const slot = await ds.getRepository(RoutineSlot).findOneByOrFail({ id: routineSlot.id });
    expect(slot.period_slot_id).toBe(periods[1].id);
  });

  it('refuses to remove a used period with PERIOD_SLOT_IN_USE', async () => {
    const { shift, periods } = await seed('b');
    const err: any = await service
      .replaceForShift(
        shift.id,
        {
          slots: [item(periods[0], 0, '08:00', '08:40'), item(periods[2], 1, '10:00', '10:40')],
        } as any,
        TENANT,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('PERIOD_SLOT_IN_USE');
  });

  it('removes an unused period and renumbers the rest without a unique-index error', async () => {
    const { shift, periods } = await seed('c');
    const result = await service.replaceForShift(
      shift.id,
      {
        slots: [item(periods[1], 0, '09:00', '09:40'), item(periods[2], 1, '10:00', '10:40')],
      } as any,
      TENANT,
    );
    expect(result.map((r) => [r.id, r.sequence])).toEqual([
      [periods[1].id, 0],
      [periods[2].id, 1],
    ]);
  });
});
