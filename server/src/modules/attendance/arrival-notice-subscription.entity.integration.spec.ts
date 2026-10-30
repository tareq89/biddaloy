import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { ArrivalNoticeSubscriptionChecks1791900000800 } from '../../migrations/1791900000800-ArrivalNoticeSubscriptionChecks';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  CommunicationTrigger,
  EnrollmentStatus,
} from '@biddaloy/shared';

/** [84.1.2] arrival_notice_subscriptions: unique key, cascades, defaults. */
describe('ArrivalNoticeSubscription entity (integration)', () => {
  let ds: DataSource;
  const TENANT_ID = SEED_TENANT_ID;
  let studentId: string;
  let guardianId: string;
  let userId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    const schoolRepo = ds.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    // Own data with a unique suffix; never reads another spec's rows.
    const sfx = randomUUID().slice(0, 8);
    const year = await ds.getRepository(AcademicYear).save({
      name: `AN-${sfx}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await ds
      .getRepository(Class)
      .save({ name: `C-${sfx}`, academic_year_id: year.id, tenant_id: TENANT_ID });
    const section = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: klass.id, tenant_id: TENANT_ID });
    const student = await ds.getRepository(Student).save({
      full_name: 'AN Student',
      registration_number: `AN-${sfx}`,
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: TENANT_ID,
      enrollment_status: EnrollmentStatus.ACTIVE,
    });
    const guardian = await ds
      .getRepository(Guardian)
      .save({ full_name: 'AN Guardian', relationship: 'Father', tenant_id: TENANT_ID });
    const user = await ds.getRepository(User).save({ full_name: `AN User ${sfx}` });
    studentId = student.id;
    guardianId = guardian.id;
    userId = user.id;
  });

  const create = (over: Partial<ArrivalNoticeSubscription> = {}) =>
    ds.getRepository(ArrivalNoticeSubscription).save({
      tenant_id: TENANT_ID,
      student_id: studentId,
      guardian_id: guardianId,
      ...over,
    });

  it('applies the column defaults', async () => {
    const row = await create();
    const found = await ds.getRepository(ArrivalNoticeSubscription).findOneByOrFail({ id: row.id });
    expect(found.status).toBe(ArrivalNoticeStatus.REQUESTED);
    expect(found.mode).toBe(ArrivalNoticeMode.RECURRING);
    expect(found.channel).toBe(ArrivalNoticeChannel.PUSH);
    expect(found.lock).toBe(ArrivalNoticeLock.NONE);
    expect(found.consumed_at).toBeNull();
  });

  it('rejects a second row for the same (tenant, student, guardian)', async () => {
    await create();
    await expect(create()).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('deleting the student deletes the row', async () => {
    const row = await create();
    await ds.query('DELETE FROM students WHERE id = $1', [studentId]);
    expect(await ds.getRepository(ArrivalNoticeSubscription).countBy({ id: row.id })).toBe(0);
  });

  it('deleting the guardian deletes the row', async () => {
    const row = await create();
    await ds.query('DELETE FROM guardians WHERE id = $1', [guardianId]);
    expect(await ds.getRepository(ArrivalNoticeSubscription).countBy({ id: row.id })).toBe(0);
  });

  it('deleting the set_by / locked_by user nulls the columns', async () => {
    const row = await create({ set_by_user_id: userId, locked_by_user_id: userId });
    await ds.query('DELETE FROM users WHERE id = $1', [userId]);
    const found = await ds.getRepository(ArrivalNoticeSubscription).findOneByOrFail({ id: row.id });
    expect(found.set_by_user_id).toBeNull();
    expect(found.locked_by_user_id).toBeNull();
  });

  it('communication_logs accepts trigger ARRIVAL_NOTICE', async () => {
    const [{ enum_range }] = await ds.query(
      `SELECT enum_range(NULL::communication_logs_trigger_enum)::text AS enum_range`,
    );
    expect(enum_range).toContain(CommunicationTrigger.ARRIVAL_NOTICE);
  });

  describe('CHECK constraints (D35)', () => {
    it('NEVER with a status other than OFF is refused', async () => {
      await expect(
        create({ lock: ArrivalNoticeLock.NEVER, status: ArrivalNoticeStatus.ACTIVE }),
      ).rejects.toThrow(/CHK_arrival_notice_subscriptions_never_off/);
    });

    it('ALWAYS needs ACTIVE + RECURRING and no consumed_at', async () => {
      const always = { lock: ArrivalNoticeLock.ALWAYS, status: ArrivalNoticeStatus.ACTIVE };
      await expect(create({ ...always, mode: ArrivalNoticeMode.ONCE })).rejects.toThrow(
        /CHK_arrival_notice_subscriptions_always_active_recurring/,
      );
      await expect(create({ ...always, status: ArrivalNoticeStatus.OFF })).rejects.toThrow(
        /CHK_arrival_notice_subscriptions_always_active_recurring/,
      );
      await expect(create(always)).resolves.toBeDefined();
    });

    it('consumed_at is only allowed for mode ONCE', async () => {
      await expect(
        create({ mode: ArrivalNoticeMode.RECURRING, consumed_at: new Date() }),
      ).rejects.toThrow(/CHK_arrival_notice_subscriptions_consumed_once/);
      await expect(
        create({
          mode: ArrivalNoticeMode.ONCE,
          status: ArrivalNoticeStatus.OFF,
          consumed_at: new Date(),
        }),
      ).resolves.toBeDefined();
    });

    it('declined_at is only allowed for status OFF', async () => {
      await expect(
        create({ status: ArrivalNoticeStatus.ACTIVE, declined_at: new Date() }),
      ).rejects.toThrow(/CHK_arrival_notice_subscriptions_declined_off/);
      await expect(
        create({ status: ArrivalNoticeStatus.OFF, declined_at: new Date() }),
      ).resolves.toBeDefined();
    });
  });

  it('the migration normalizes rows that broke the rules before adding the CHECKs', async () => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const m = new ArrivalNoticeSubscriptionChecks1791900000800();
      await m.down(qr); // back to the old shape, then plant rows the old code could write
      const [g2, g3] = [randomUUID(), randomUUID()];
      for (const id of [g2, g3]) {
        await qr.query(
          `INSERT INTO guardians (id, full_name, relationship, tenant_id) VALUES ($1, 'G', 'Father', $2)`,
          [id, TENANT_ID],
        );
      }
      const ins = (g: string, status: string, mode: string, lock: string, consumed: boolean) =>
        qr.query(
          `INSERT INTO arrival_notice_subscriptions (tenant_id, student_id, guardian_id, status, mode, lock, consumed_at)
           VALUES ($1, $2, $3, $4, $5, $6, ${consumed ? 'now()' : 'NULL'}) RETURNING id`,
          [TENANT_ID, studentId, g, status, mode, lock],
        );
      const [{ id: never }] = await ins(g2, 'ACTIVE', 'RECURRING', 'NEVER', false);
      const [{ id: always }] = await ins(g3, 'OFF', 'ONCE', 'ALWAYS', true);
      const [{ id: stray }] = await ins(guardianId, 'ACTIVE', 'RECURRING', 'NONE', true);
      await m.up(qr);
      const get = async (id: string) =>
        (
          await qr.query(
            `SELECT status, mode, consumed_at FROM arrival_notice_subscriptions WHERE id = $1`,
            [id],
          )
        )[0];
      expect(await get(never)).toMatchObject({ status: 'OFF', consumed_at: null });
      expect(await get(always)).toMatchObject({
        status: 'ACTIVE',
        mode: 'RECURRING',
        consumed_at: null,
      });
      expect((await get(stray)).consumed_at).toBeNull();
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
