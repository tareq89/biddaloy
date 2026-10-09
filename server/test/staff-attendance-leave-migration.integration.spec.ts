import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';
import { StaffAttendanceLeave1789800014000 } from '../src/migrations/1789800014000-StaffAttendanceLeave';

/**
 * [36.1.1] DB-level invariants the `StaffAttendanceLeave1789800014000`
 * migration adds, that no unit test can see: constraints only Postgres
 * enforces, plus the backfill's shape.
 *
 * Note on backfill coverage: this suite's global setup
 * (`server/test/global-setup.ts`) runs every migration once, then inserts
 * the baseline seed row set (`buildReferenceResetSql()`) *afterwards*, for
 * speed — so the one baseline user it creates (the seed ADMIN) postdates
 * this migration's backfill and correctly has no `staff_profiles` row of
 * its own. That is a property of this test harness's setup order, not of
 * the migration — the migration backfills whatever `users`/`user_tenants`
 * rows exist *at migration time*, which in a real dev/prod DB is every
 * pre-existing staff user. This suite instead builds its own fixture rows
 * and asserts the schema-level invariants the migration installs.
 */
describe('StaffAttendanceLeave1789800014000 (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates a staff_profiles row unique per (tenant, employee_id) and per user', async () => {
    const [user] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test') RETURNING id`,
      [`staff-migration-test-a-${Date.now()}@test.local`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [user.id, TENANT_ID, `EMP-TEST-${Date.now()}`],
    );
    expect(profile.id).toBeTruthy();

    // Same user, second staff_profiles row — rejected (UQ_staff_profiles_user).
    await expect(
      dataSource.query(
        `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
        [user.id, TENANT_ID, `EMP-TEST-OTHER-${Date.now()}`],
      ),
    ).rejects.toThrow();
  });

  it('rejects two staff_profiles rows sharing an employee_id within one tenant', async () => {
    const employeeId = `EMP-DUP-${Date.now()}`;
    const [userA] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test A') RETURNING id`,
      [`staff-migration-test-b-${Date.now()}@test.local`],
    );
    const [userB] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test B') RETURNING id`,
      [`staff-migration-test-c-${Date.now()}@test.local`],
    );
    await dataSource.query(
      `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
      [userA.id, TENANT_ID, employeeId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
        [userB.id, TENANT_ID, employeeId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a null teachers.staff_profile_id (column locked NOT NULL by the migration)', async () => {
    const [user] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test') RETURNING id`,
      [`staff-migration-test-d-${Date.now()}@test.local`],
    );
    await expect(
      dataSource.query(
        `INSERT INTO "teachers" (id, user_id, employee_id, tenant_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
        [user.id, `EMP-NULL-TEST-${Date.now()}`, TENANT_ID],
      ),
    ).rejects.toThrow();
  });

  it('accepts a teachers row once staff_profile_id points at a real staff_profiles row', async () => {
    const [user] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test') RETURNING id`,
      [`staff-migration-test-e-${Date.now()}@test.local`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [user.id, TENANT_ID, `EMP-OK-${Date.now()}`],
    );
    const [teacher] = await dataSource.query(
      `INSERT INTO "teachers" (id, user_id, employee_id, tenant_id, staff_profile_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id, staff_profile_id`,
      [user.id, `EMP-TEACHER-OK-${Date.now()}`, TENANT_ID, profile.id],
    );
    expect(teacher.staff_profile_id).toBe(profile.id);
  });

  // `SEED_TENANT_ID`'s school row is inserted by `buildReferenceResetSql()`
  // *after* this migration ran (see the file-header note), so it never
  // received the migration's D9-default seed — that seed only covers
  // tenants that existed at migration time, which in a real dev/prod DB is
  // every tenant. This test instead reproduces the migration's exact
  // seed statement's shape against a fresh tenant, to pin the defaults and
  // the per-(tenant, leave_type) uniqueness it relies on.
  it('the D9-default seed shape is unique per (tenant, leave_type) and matches the documented quotas', async () => {
    const [school] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Migration Test School', $1) RETURNING id`,
      [`migration-test-school-${Date.now()}`],
    );
    await dataSource.query(
      `
      INSERT INTO "leave_policies" (id, tenant_id, leave_type, annual_quota_days)
      SELECT gen_random_uuid(), $1, v.leave_type, v.quota
      FROM (VALUES
        ('CASUAL'::"public"."leave_type_enum", 10),
        ('SICK'::"public"."leave_type_enum", 14),
        ('EARNED'::"public"."leave_type_enum", 15),
        ('MATERNITY'::"public"."leave_type_enum", 112),
        ('PATERNITY'::"public"."leave_type_enum", 7)
      ) AS v(leave_type, quota)
      `,
      [school.id],
    );
    const rows = await dataSource.query(
      `SELECT leave_type, annual_quota_days FROM leave_policies WHERE tenant_id = $1 ORDER BY leave_type`,
      [school.id],
    );
    const byType = Object.fromEntries(rows.map((r: any) => [r.leave_type, r.annual_quota_days]));
    expect(byType).toEqual({
      CASUAL: 10,
      SICK: 14,
      MATERNITY: 112,
      PATERNITY: 7,
      EARNED: 15,
    });

    await expect(
      dataSource.query(
        `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days) VALUES (gen_random_uuid(), $1, 'CASUAL', 99)`,
        [school.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects two staff_attendance_records rows for the same session and staff_profile', async () => {
    const [user] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test') RETURNING id`,
      [`staff-migration-test-f-${Date.now()}@test.local`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [user.id, TENANT_ID, `EMP-REC-${Date.now()}`],
    );
    const [session] = await dataSource.query(
      `INSERT INTO staff_attendance_sessions (id, tenant_id, date) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [TENANT_ID, '2026-09-27'],
    );
    await dataSource.query(
      `INSERT INTO staff_attendance_records (id, tenant_id, session_id, staff_profile_id, status) VALUES (gen_random_uuid(), $1, $2, $3, 'PRESENT')`,
      [TENANT_ID, session.id, profile.id],
    );
    await expect(
      dataSource.query(
        `INSERT INTO staff_attendance_records (id, tenant_id, session_id, staff_profile_id, status) VALUES (gen_random_uuid(), $1, $2, $3, 'ABSENT')`,
        [TENANT_ID, session.id, profile.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects two staff_attendance_sessions rows for the same tenant and date', async () => {
    await dataSource.query(
      `INSERT INTO staff_attendance_sessions (id, tenant_id, date) VALUES (gen_random_uuid(), $1, $2)`,
      [TENANT_ID, '2026-09-28'],
    );
    await expect(
      dataSource.query(
        `INSERT INTO staff_attendance_sessions (id, tenant_id, date) VALUES (gen_random_uuid(), $1, $2)`,
        [TENANT_ID, '2026-09-28'],
      ),
    ).rejects.toThrow();
  });

  // The other tests above prove the *schema* the migration leaves behind is
  // correct, but never actually run the backfill statements (see the file
  // header note — this suite's fixture users postdate migration time). This
  // test runs the real `up()`/`down()` in a transaction against fixture
  // `users`/`user_tenants`/`teachers` rows that predate the migration, then
  // rolls the whole thing back — Postgres DDL is transactional, so this never
  // touches the schema the rest of the suite (or other spec files sharing
  // this worker's database) depend on.
  it('backfill: gives every staff user a staff_profiles row, reusing a Teacher row employee_id where one exists', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const migration = new StaffAttendanceLeave1789800014000();
      // Roll back to pre-migration shape: no staff_profiles table, no
      // teachers.staff_profile_id column.
      await migration.down(queryRunner);

      const suffix = Date.now();
      const [school] = await queryRunner.query(
        `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Backfill Test School', $1) RETURNING id`,
        [`backfill-test-school-${suffix}`],
      );
      const insertUser = async (email: string) => {
        const [row] = await queryRunner.query(
          `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Backfill Test') RETURNING id`,
          [email],
        );
        return row.id as string;
      };
      const teacherUserId = await insertUser(`backfill-teacher-${suffix}@test.local`);
      const adminUserId = await insertUser(`backfill-admin-${suffix}@test.local`);

      // A Teacher row (pre-migration shape has no staff_profile_id column).
      await queryRunner.query(
        `INSERT INTO "teachers" (id, user_id, employee_id, tenant_id, joining_date) VALUES (gen_random_uuid(), $1, $2, $3, '2020-01-01')`,
        [teacherUserId, `EMP-EXISTING-${suffix}`, school.id],
      );
      // An ADMIN with no Teacher row — must get a generated employee_id.
      await queryRunner.query(
        `INSERT INTO "user_tenants" (id, user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, $2, 'ADMIN')`,
        [adminUserId, school.id],
      );

      await migration.up(queryRunner);

      const profiles = await queryRunner.query(
        `SELECT id, user_id, employee_id FROM staff_profiles WHERE tenant_id = $1 ORDER BY employee_id`,
        [school.id],
      );
      expect(profiles).toHaveLength(2);

      const teacherProfile = profiles.find((p: any) => p.user_id === teacherUserId);
      expect(teacherProfile?.employee_id).toBe(`EMP-EXISTING-${suffix}`);

      const adminProfile = profiles.find((p: any) => p.user_id === adminUserId);
      expect(adminProfile?.employee_id).toMatch(/^EMP-/);

      const [teacherRow] = await queryRunner.query(
        `SELECT staff_profile_id FROM teachers WHERE user_id = $1`,
        [teacherUserId],
      );
      expect(teacherRow.staff_profile_id).toBe(teacherProfile.id);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('sets approved_by to null when the approving user is deleted (leave_records)', async () => {
    const [staffUser] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test') RETURNING id`,
      [`staff-migration-test-g-${Date.now()}@test.local`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO "staff_profiles" (id, user_id, tenant_id, employee_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [staffUser.id, TENANT_ID, `EMP-LEAVE-${Date.now()}`],
    );
    // A throwaway approver — not the shared seed admin, so deleting it can't
    // affect any other test in this run.
    const [approver] = await dataSource.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Migration Test Approver') RETURNING id`,
      [`staff-migration-test-h-${Date.now()}@test.local`],
    );
    const [leave] = await dataSource.query(
      `INSERT INTO leave_records (id, tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, approved_by)
       VALUES (gen_random_uuid(), $1, $2, 'CASUAL', '2026-10-01', '2026-10-02', 2, 'APPROVED', $3) RETURNING id`,
      [TENANT_ID, profile.id, approver.id],
    );
    await dataSource.query(`DELETE FROM "users" WHERE id = $1`, [approver.id]);
    const [reloaded] = await dataSource.query(
      `SELECT approved_by FROM leave_records WHERE id = $1`,
      [leave.id],
    );
    expect(reloaded.approved_by).toBeNull();
  });
});
