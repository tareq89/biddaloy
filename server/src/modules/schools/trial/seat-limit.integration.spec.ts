import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { StudentService, GuardianService } from '../../students/students.service';
import { AuditService } from '../../audit/audit.service';
import { Student } from '../../students/entities/student.entity';
import { School } from '../entities/school.entity';
import { SeatLimitService, assertSeatsAvailable } from './seat-limit.service';

const dto = (name: string) => ({
  full_name: name,
  class_section_id: SEED_SECTION_1_ID,
  preferred_communication: CommunicationMedium.SMS,
});

describe('seat limit (integration)', () => {
  let ds: DataSource;
  let students: StudentService;
  let seats: SeatLimitService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      StudentService,
      GuardianService,
      AuditService,
      SeatLimitService,
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    students = module.get(StudentService);
    seats = module.get(SeatLimitService);
  }, 60000);

  afterEach(async () => {
    await ds.query('DELETE FROM student_guardians');
    await ds.query('DELETE FROM enrollments WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await ds.query('DELETE FROM students WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await ds.getRepository(School).update(SEED_TENANT_ID, { seat_limit: null });
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const setLimit = (n: number | null) =>
    ds.getRepository(School).update(SEED_TENANT_ID, { seat_limit: n });

  it('usage counts only ACTIVE, non-deleted students', async () => {
    await setLimit(5);
    const a = await students.create(dto('A'), SEED_TENANT_ID);
    const b = await students.create(dto('B'), SEED_TENANT_ID);
    const c = await students.create(dto('C'), SEED_TENANT_ID);
    // INACTIVE and soft-deleted students must not hold a seat (D29).
    await ds.getRepository(Student).update(b.id, { enrollment_status: EnrollmentStatus.INACTIVE });
    await ds.getRepository(Student).softDelete(c.id);

    expect(await seats.usage(SEED_TENANT_ID)).toEqual({ used: 1, limit: 5 });
    expect(a.id).toBeDefined();
  });

  it('allows up to the limit, then refuses with 409 SEAT_LIMIT_REACHED', async () => {
    await setLimit(2);
    await students.create(dto('A'), SEED_TENANT_ID);
    await students.create(dto('B'), SEED_TENANT_ID);

    const err = await students.create(dto('C'), SEED_TENANT_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details).toEqual({
      code: 'SEAT_LIMIT_REACHED',
      used: 2,
      limit: 2,
      requested: 1,
    });
    // Nothing partial: the refused create left no student behind.
    expect((await seats.usage(SEED_TENANT_ID)).used).toBe(2);
  });

  it('a freed seat can be reused (INACTIVE does not count)', async () => {
    await setLimit(1);
    const a = await students.create(dto('A'), SEED_TENANT_ID);
    await ds.getRepository(Student).update(a.id, { enrollment_status: EnrollmentStatus.INACTIVE });
    await expect(students.create(dto('B'), SEED_TENANT_ID)).resolves.toBeDefined();
  });

  it('seat_limit = null is unlimited', async () => {
    await setLimit(null);
    await students.create(dto('A'), SEED_TENANT_ID);
    await students.create(dto('B'), SEED_TENANT_ID);
    await ds.transaction((m) => assertSeatsAvailable(m, SEED_TENANT_ID, 1000));
    expect(await seats.usage(SEED_TENANT_ID)).toEqual({ used: 2, limit: null });
  });

  it('assertCanAdd counts the whole batch: exactly at the limit passes, one over fails', async () => {
    await setLimit(3);
    await students.create(dto('A'), SEED_TENANT_ID);
    await ds.transaction((m) => seats.assertCanAdd(SEED_TENANT_ID, 2, m));
    await expect(
      ds.transaction((m) => seats.assertCanAdd(SEED_TENANT_ID, 3, m)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('parallel creates at limit - 1 admit exactly one (the School row lock)', async () => {
    await setLimit(2);
    await students.create(dto('A'), SEED_TENANT_ID);

    // Open the pool's connections first. A cold pool connects lazily, which makes parallel calls
    // run almost one after another and hides the race this test exists to catch.
    await Promise.all(Array.from({ length: 8 }, () => ds.query('SELECT pg_sleep(0.2)')));
    // Several at once, so the check-then-insert race is hit reliably, not by luck.
    const results = await Promise.allSettled(
      ['B', 'C', 'D', 'E', 'F', 'G'].map((n) => students.create(dto(n), SEED_TENANT_ID)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
    expect((await seats.usage(SEED_TENANT_ID)).used).toBe(2);
  });
});
