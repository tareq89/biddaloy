import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { User } from '../src/modules/users/entities/user.entity';
import { StaffProfile } from '../src/modules/staff-profiles/entities/staff-profile.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Applications1791500000000 } from '../src/migrations/1791500000000-Applications';
import { MovePendingLeaveToApplications1791500000100 } from '../src/migrations/1791500000100-MovePendingLeaveToApplications';
import { RerunMovePendingLeaveToApplications1791500000200 } from '../src/migrations/1791500000200-RerunMovePendingLeaveToApplications';

/**
 * [52.1.2] Applications schema (constraints, cascades, leave changes) and the
 * D20 data step. Builds its own fixture rows. The schema migration is applied
 * once by global-setup and its `down()` is NOT run here (it would drop the
 * shared worker schema); the data step is called directly and the suite always
 * ends with its `up()` applied.
 */
describe('Applications migration (integration)', () => {
  let ds: DataSource;
  let queryRunner: QueryRunner;
  const migration = new MovePendingLeaveToApplications1791500000100();
  const schoolIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    queryRunner = ds.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    // Applications/leave rows of the extra schools go with the school (CASCADE).
    await ds.query(`DELETE FROM applications WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM leave_records WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    if (schoolIds.length) await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]);
    await queryRunner.release();
    await ds.destroy();
  });

  async function school(settings: object | null): Promise<string> {
    seq += 1;
    const [row] = await ds.query(
      `INSERT INTO schools (id, name, slug, settings) VALUES (gen_random_uuid(), 'Apps Migration', $1, $2::jsonb) RETURNING id`,
      [`apps-migration-${Date.now()}-${seq}`, settings && JSON.stringify(settings)],
    );
    schoolIds.push(row.id);
    return row.id;
  }

  async function user(): Promise<string> {
    seq += 1;
    const saved = await ds.getRepository(User).save({
      email: `apps-mig-${Date.now()}-${seq}@test.com`,
      full_name: 'Apps Migration User',
    });
    return saved.id;
  }

  async function staff(tenantId: string): Promise<{ userId: string; profileId: string }> {
    const userId = await user();
    seq += 1;
    const p = await ds.getRepository(StaffProfile).save({
      user_id: userId,
      tenant_id: tenantId,
      employee_id: `EMP-APPS-${Date.now()}-${seq}`,
    });
    return { userId, profileId: p.id };
  }

  async function student(): Promise<string> {
    seq += 1;
    const s = await ds.getRepository(Student).save({
      tenant_id: SEED_TENANT_ID,
      full_name: 'Apps Migration Student',
      registration_number: `APPS-MIG-${Date.now()}-${seq}`,
      roll_number: 9000 + seq,
      class_section_id: SEED_SECTION_1_ID,
    });
    return s.id;
  }

  /** Inserts an application with sane defaults; `over` overrides columns. */
  async function app(over: Record<string, unknown>): Promise<string> {
    seq += 1;
    const row: Record<string, unknown> = {
      tenant_id: SEED_TENANT_ID,
      type: 'STAFF_LEAVE',
      source: 'APP',
      serial_year: 1900 + seq, // unique year so fixtures never collide
      serial_no: 1,
      letter_text: 'x',
      letter_locale: 'en',
      ...over,
    };
    const cols = Object.keys(row);
    const [r] = await ds.query(
      `INSERT INTO applications (${cols.map((c) => `"${c}"`).join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      cols.map((c) => row[c]),
    );
    return r.id;
  }

  async function leave(
    tenantId: string,
    profileId: string,
    status: string,
    over: {
      reason?: string | null;
      start?: string;
      end?: string;
      days?: number;
      created?: string;
    } = {},
  ): Promise<string> {
    const [r] = await ds.query(
      `INSERT INTO leave_records (id, tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, reason, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'CASUAL', $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [
        tenantId,
        profileId,
        over.start ?? '2026-03-10',
        over.end ?? '2026-03-11',
        over.days ?? 2,
        status,
        over.reason === undefined ? 'family' : over.reason,
        over.created ?? '2026-03-01T10:00:00Z',
      ],
    );
    return r.id;
  }

  async function rejects(sql: string, params: unknown[], pattern: RegExp) {
    await expect(ds.query(sql, params)).rejects.toThrow(pattern);
  }

  describe('schema constraints', () => {
    it('CHECK: exactly one subject (both set, or none, is rejected)', async () => {
      const { userId, profileId } = await staff(SEED_TENANT_ID);
      const studentId = await student();
      await expect(
        app({
          applicant_user_id: userId,
          subject_staff_profile_id: profileId,
          subject_student_id: studentId,
        }),
      ).rejects.toThrow(/CHK_applications_one_subject/);
      await expect(app({ applicant_user_id: userId })).rejects.toThrow(
        /CHK_applications_one_subject/,
      );
      await expect(
        app({ applicant_user_id: userId, subject_staff_profile_id: profileId }),
      ).resolves.toBeTruthy();
    });

    it('CHECK (D46): applicant NULL needs source PAPER and an applicant_name', async () => {
      const studentId = await student();
      // APP with no applicant: rejected
      await expect(
        app({ source: 'APP', applicant_name: 'Karim', subject_student_id: studentId }),
      ).rejects.toThrow(/CHK_applications_applicant/);
      // PAPER with a name: a guardian with no login, accepted
      await expect(
        app({ source: 'PAPER', applicant_name: 'Karim', subject_student_id: studentId }),
      ).resolves.toBeTruthy();
      // PAPER with neither: rejected
      await expect(app({ source: 'PAPER', subject_student_id: studentId })).rejects.toThrow(
        /CHK_applications_applicant/,
      );
    });

    it('serial is unique per tenant+year; the same serial in another tenant is fine', async () => {
      const studentId = await student();
      const { userId } = await staff(SEED_TENANT_ID);
      const year = 1800;
      const base = {
        applicant_user_id: userId,
        subject_student_id: studentId,
        serial_year: year,
        serial_no: 7,
      };
      await app(base);
      await expect(app(base)).rejects.toThrow(/UQ_applications_tenant_serial/);

      const other = await school(null);
      const o = await staff(other);
      // another tenant, same year + number
      await expect(
        app({
          tenant_id: other,
          applicant_user_id: o.userId,
          subject_staff_profile_id: o.profileId,
          serial_year: year,
          serial_no: 7,
        }),
      ).resolves.toBeTruthy();
    });

    it('tags: user_id xor role, and no duplicate role per application', async () => {
      const { userId, profileId } = await staff(SEED_TENANT_ID);
      const applicationId = await app({
        applicant_user_id: userId,
        subject_staff_profile_id: profileId,
      });
      const ins = `INSERT INTO application_tags (tenant_id, application_id, user_id, role, created_by_user_id) VALUES ($1, $2, $3, $4, $5)`;
      await rejects(
        ins,
        [SEED_TENANT_ID, applicationId, userId, 'ADMIN', userId],
        /CHK_application_tags_user_xor_role/,
      );
      await ds.query(ins, [SEED_TENANT_ID, applicationId, null, 'ADMIN', userId]);
      await rejects(
        ins,
        [SEED_TENANT_ID, applicationId, null, 'ADMIN', userId],
        /UQ_application_tags_role/,
      );
    });

    it('tags: role must be a tenant staff role (D50)', async () => {
      const { userId, profileId } = await staff(SEED_TENANT_ID);
      const applicationId = await app({
        applicant_user_id: userId,
        subject_staff_profile_id: profileId,
      });
      const ins = `INSERT INTO application_tags (tenant_id, application_id, role, created_by_user_id) VALUES ($1, $2, $3, $4)`;
      for (const bad of ['SUPER_ADMIN', 'PARENT', 'Admin']) {
        await rejects(
          ins,
          [SEED_TENANT_ID, applicationId, bad, userId],
          /CHK_application_tags_role/,
        );
      }
      await ds.query(ins, [SEED_TENANT_ID, applicationId, 'OFFICE_STAFF', userId]);
    });

    it("a child row cannot name another school's application (composite tenant FK)", async () => {
      const { userId, profileId } = await staff(SEED_TENANT_ID);
      const applicationId = await app({
        applicant_user_id: userId,
        subject_staff_profile_id: profileId,
      });
      const other = await school(null);
      await rejects(
        `INSERT INTO application_events (tenant_id, application_id, actor_user_id, kind) VALUES ($1, $2, $3, 'COMMENT')`,
        [other, applicationId, userId],
        /FK_application_events_application/,
      );
      await rejects(
        `INSERT INTO application_tags (tenant_id, application_id, role, created_by_user_id) VALUES ($1, $2, 'ADMIN', $3)`,
        [other, applicationId, userId],
        /FK_application_tags_application/,
      );
      await rejects(
        `INSERT INTO application_attachments (tenant_id, application_id, storage_key, file_name, mime_type, size_bytes, uploaded_by_user_id) VALUES ($1, $2, 'k2', 'a.pdf', 'application/pdf', 10, $3)`,
        [other, applicationId, userId],
        /FK_application_attachments_application/,
      );
      // leave_records too: a leave row in the other school cannot link this school's application.
      const otherStaff = await staff(other);
      const otherLeave = await leave(other, otherStaff.profileId, 'APPROVED');
      await rejects(
        `UPDATE leave_records SET application_id = $1 WHERE id = $2`,
        [applicationId, otherLeave],
        /FK_leave_records_application/,
      );
    });

    it('deleting an application cascades events, tags, attachments and NULLs leave_records.application_id', async () => {
      const { userId, profileId } = await staff(SEED_TENANT_ID);
      const applicationId = await app({
        applicant_user_id: userId,
        subject_staff_profile_id: profileId,
      });
      await ds.query(
        `INSERT INTO application_events (tenant_id, application_id, actor_user_id, kind) VALUES ($1, $2, $3, 'SUBMITTED')`,
        [SEED_TENANT_ID, applicationId, userId],
      );
      await ds.query(
        `INSERT INTO application_tags (tenant_id, application_id, role, created_by_user_id) VALUES ($1, $2, 'ADMIN', $3)`,
        [SEED_TENANT_ID, applicationId, userId],
      );
      await ds.query(
        `INSERT INTO application_attachments (tenant_id, application_id, storage_key, file_name, mime_type, size_bytes, uploaded_by_user_id) VALUES ($1, $2, 'k', 'a.pdf', 'application/pdf', 10, $3)`,
        [SEED_TENANT_ID, applicationId, userId],
      );
      const leaveId = await leave(SEED_TENANT_ID, profileId, 'APPROVED');
      await ds.query(`UPDATE leave_records SET application_id = $1 WHERE id = $2`, [
        applicationId,
        leaveId,
      ]);

      await ds.query(`DELETE FROM applications WHERE id = $1`, [applicationId]);

      for (const t of ['application_events', 'application_tags', 'application_attachments']) {
        const [{ n }] = await ds.query(
          `SELECT count(*)::int AS n FROM ${t} WHERE application_id = $1`,
          [applicationId],
        );
        expect(n).toBe(0);
      }
      const [lr] = await ds.query(
        `SELECT application_id, tenant_id FROM leave_records WHERE id = $1`,
        [leaveId],
      );
      expect(lr.application_id).toBeNull();
      // SET NULL ("application_id") nulls only that column; the row keeps its school.
      expect(lr.tenant_id).toBe(SEED_TENANT_ID);
    });

    it('leave_policies.annual_quota_days accepts NULL; leave_records.status accepts CANCELLED', async () => {
      const tenant = await school(null);
      const { profileId } = await staff(tenant);
      await ds.query(
        `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'SICK', NULL, now(), now())`,
        [tenant],
      );
      const id = await leave(tenant, profileId, 'CANCELLED');
      const [row] = await ds.query(`SELECT status FROM leave_records WHERE id = $1`, [id]);
      expect(row.status).toBe('CANCELLED');
    });
  });

  // Runs the real schema down() then up() inside one transaction that is rolled back, so the
  // shared worker schema is never touched (Postgres DDL is transactional).
  describe('Applications1791500000000 round trip', () => {
    it('down() refuses an unlimited (NULL) quota, then down() + up() rebuild every index and constraint', async () => {
      const schema = new Applications1791500000000();
      const unlimited = await school(null);
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        // down() fails loudly on rows the old schema cannot hold (D19 NULL quota, D31 CANCELLED).
        await qr.query(`DELETE FROM leave_records WHERE status = 'CANCELLED'`);
        await qr.query(
          `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'SICK', NULL, now(), now())`,
          [unlimited],
        );
        await qr.query(`SAVEPOINT before_down`);
        await expect(schema.down(qr)).rejects.toThrow(/annual_quota_days/);
        await qr.query(`ROLLBACK TO SAVEPOINT before_down`);
        await qr.query(`DELETE FROM leave_policies WHERE annual_quota_days IS NULL`);

        await schema.down(qr);
        const [{ gone }] = await qr.query(`SELECT to_regclass('public.applications') AS gone`);
        expect(gone).toBeNull();

        await schema.up(qr);
        const indexes = await qr.query(
          `SELECT indexname FROM pg_indexes WHERE tablename IN ('applications', 'application_tags')`,
        );
        expect(indexes.map((r: { indexname: string }) => r.indexname)).toEqual(
          expect.arrayContaining([
            'IDX_applications_tenant_addressee_user',
            'IDX_application_tags_tenant_user',
            'IDX_application_tags_tenant_role',
            'UQ_applications_tenant_id',
          ]),
        );
        const constraints = await qr.query(
          `SELECT conname FROM pg_constraint WHERE conname = ANY($1)`,
          [
            [
              'CHK_application_tags_role',
              'FK_application_events_application',
              'FK_application_tags_application',
              'FK_application_attachments_application',
              'FK_leave_records_application',
            ],
          ],
        );
        expect(constraints).toHaveLength(5);
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
    });
  });

  describe('MovePendingLeaveToApplications (D20)', () => {
    it('fails loudly on a PENDING row whose staff profile is in another school', async () => {
      const home = await school(null);
      const elsewhere = await school(null);
      const { profileId } = await staff(elsewhere);
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query(
          `INSERT INTO leave_records (id, tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'CASUAL', '2026-03-10', '2026-03-11', 2, 'PENDING', now(), now())`,
          [home, profileId],
        );
        await expect(migration.up(qr)).rejects.toThrow(/could not be moved/);
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
    });

    it('moves PENDING leave to applications, keeps APPROVED, is idempotent, and down() restores', async () => {
      // Production shapes: a school with NO settings blob, a second school in the
      // same year with English locale, a NULL reason, and an existing serial.
      const a = await school(null);
      const b = await school({ region: { locale: 'en-BD', timezone: 'Asia/Dhaka' } });
      const c = await school({ region: { locale: 'bn-BD' } });
      const sc = await staff(c);
      await leave(c, sc.profileId, 'PENDING', { created: '2026-03-06T10:00:00Z' });
      const sa = await staff(a);
      const sb = await staff(b);

      await ds.query(
        `INSERT INTO applications (tenant_id, type, source, serial_year, serial_no, applicant_user_id, subject_staff_profile_id, letter_text, letter_locale)
         VALUES ($1, 'STAFF_LEAVE', 'APP', 2026, 5, $2, $3, 'x', 'bn')`,
        [a, sa.userId, sa.profileId],
      );
      const a1 = await leave(a, sa.profileId, 'PENDING', {
        created: '2026-03-01T10:00:00Z',
        reason: null,
      });
      const a2 = await leave(a, sa.profileId, 'PENDING', {
        created: '2026-03-02T10:00:00Z',
        start: '2026-04-01',
        end: '2026-04-03',
        days: 3,
        reason: 'wedding',
      });
      const aApproved = await leave(a, sa.profileId, 'APPROVED');
      const b1 = await leave(b, sb.profileId, 'PENDING', {
        created: '2026-03-05T10:00:00Z',
        reason: 'fever',
      });

      await migration.up(queryRunner);

      const apps = await ds.query(
        `SELECT * FROM applications WHERE tenant_id = $1 AND type = 'STAFF_LEAVE' AND status = 'PENDING' AND serial_no > 5 ORDER BY serial_no`,
        [a],
      );
      expect(apps).toHaveLength(2);
      // Serials continue after the existing max (5) in this tenant+year, in created_at order.
      expect(apps.map((r: any) => [r.serial_year, r.serial_no])).toEqual([
        [2026, 6],
        [2026, 7],
      ]);
      expect(apps[0].payload).toEqual({
        leave_type: 'CASUAL',
        start_date: '2026-03-10',
        end_date: '2026-03-11',
        reason: '', // NULL reason becomes ''
      });
      expect(apps[1].payload.reason).toBe('wedding');
      expect(apps[0]).toMatchObject({
        source: 'APP',
        applicant_user_id: sa.userId,
        subject_staff_profile_id: sa.profileId,
        letter_locale: 'bn', // no settings blob -> default bn
        current_step: 0,
      });
      expect(apps[0].letter_text).toContain('ছুটির আবেদন');

      // The other tenant numbers independently from 1, in its own locale.
      const [bApp] = await ds.query(`SELECT * FROM applications WHERE tenant_id = $1`, [b]);
      expect(bApp.serial_no).toBe(1);
      expect(bApp.letter_locale).toBe('en'); // 'en-BD' stored as 'en'
      const [cApp] = await ds.query(`SELECT letter_locale FROM applications WHERE tenant_id = $1`, [
        c,
      ]);
      expect(cApp.letter_locale).toBe('bn'); // 'bn-BD' stored as 'bn'
      expect(bApp.letter_text).toBe('Leave request: 2026-03-10 to 2026-03-11. Reason: fever');

      // One SUBMITTED event each, carrying the old id and days.
      const events = await ds.query(
        `SELECT e.* FROM application_events e WHERE e.application_id = ANY($1) ORDER BY e.created_at`,
        [apps.map((r: any) => r.id)],
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ kind: 'SUBMITTED', step: 0, actor_user_id: sa.userId });
      expect(events[0].data).toEqual({ migrated_from_leave_record_id: a1, days: 2 });
      expect(events[1].data).toEqual({ migrated_from_leave_record_id: a2, days: 3 });

      // PENDING leave rows are gone; the APPROVED one is untouched.
      const left = await ds.query(
        `SELECT id, status FROM leave_records WHERE tenant_id = ANY($1)`,
        [[a, b]],
      );
      expect(left).toEqual([{ id: aApproved, status: 'APPROVED' }]);

      // Second run adds nothing.
      await migration.up(queryRunner);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM applications WHERE tenant_id = ANY($1)`,
        [[a, b]],
      );
      expect(n).toBe(4); // 1 pre-existing + 2 + 1

      try {
        await migration.down(queryRunner);
        const restored = await ds.query(
          `SELECT id, days, status, reason, start_date::text, end_date::text FROM leave_records WHERE id = ANY($1) ORDER BY id`,
          [[a1, a2, b1]],
        );
        expect(restored).toHaveLength(3);
        const byId = Object.fromEntries(restored.map((r: any) => [r.id, r]));
        expect(byId[a1]).toMatchObject({ days: 2, status: 'PENDING', reason: null });
        expect(byId[a2]).toMatchObject({
          days: 3,
          status: 'PENDING',
          reason: 'wedding',
          start_date: '2026-04-01',
        });
        // Only the migrated applications are removed; the pre-existing one stays.
        const [{ m }] = await ds.query(
          `SELECT count(*)::int AS m FROM applications WHERE tenant_id = ANY($1)`,
          [[a, b]],
        );
        expect(m).toBe(1);
      } finally {
        // Leave the worker DB in its migrated state for later spec files.
        await migration.up(queryRunner);
      }
      const [{ k }] = await ds.query(
        `SELECT count(*)::int AS k FROM applications WHERE tenant_id = ANY($1)`,
        [[a, b]],
      );
      expect(k).toBe(4);
    });
  });

  describe('RerunMovePendingLeaveToApplications (D15)', () => {
    const rerun = new RerunMovePendingLeaveToApplications1791500000200();

    it('moves a PENDING row filed after the first move; a second run (nothing pending) changes nothing', async () => {
      const t = await school(null);
      const s = await staff(t);
      await leave(t, s.profileId, 'APPROVED');
      await migration.up(queryRunner); // first move: nothing of ours pending yet

      // The old route files a PENDING row after the first move.
      const late = await leave(t, s.profileId, 'PENDING', { reason: 'late' });
      await rerun.up(queryRunner);

      const apps = await ds.query(
        `SELECT payload, status, subject_staff_profile_id FROM applications WHERE tenant_id = $1`,
        [t],
      );
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ status: 'PENDING', subject_staff_profile_id: s.profileId });
      expect(apps[0].payload.reason).toBe('late');
      const gone = await ds.query(`SELECT 1 FROM leave_records WHERE id = $1`, [late]);
      expect(gone).toHaveLength(0);

      // Nothing pending: no new application, the APPROVED row stays.
      await rerun.up(queryRunner);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM applications WHERE tenant_id = $1`,
        [t],
      );
      expect(n).toBe(1);
      const [{ m }] = await ds.query(
        `SELECT count(*)::int AS m FROM leave_records WHERE tenant_id = $1 AND status = 'APPROVED'`,
        [t],
      );
      expect(m).toBe(1);
    });
  });
});
