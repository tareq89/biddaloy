import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
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
});
