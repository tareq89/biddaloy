import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { TenantControlLoginAs1792100000000 } from '../src/migrations/1792100000000-TenantControlLoginAs';

/** [Epic 99 / #3783] up/down/up of the Login as migration on the migrated test database. */
describe('TenantControlLoginAs1792100000000 (integration)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let schoolId: string;
  let adminId: string;
  const migration = new TenantControlLoginAs1792100000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    ds = module.get(DataSource);
    qr = ds.createQueryRunner();
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'TC Mig School', 'tc-mig-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    schoolId = id;
    const [u] = await ds.query(
      `INSERT INTO "users" (id, email, full_name) VALUES (gen_random_uuid(), 'tc-mig-' || substr(gen_random_uuid()::text, 1, 8) || '@example.test', 'TC Mig Admin') RETURNING id`,
    );
    adminId = u.id;
    await ds.query(`INSERT INTO "platform_admins" (user_id) VALUES ($1)`, [adminId]);
  }, 60000);

  afterAll(async () => {
    await qr.release();
    await ds.destroy();
  });

  const exists = async (t: string) =>
    (
      await ds.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [t],
      )
    ).length === 1;

  const newSession = async (status = 'ACTIVE', kind = 'NORMAL') =>
    ds.query(
      `INSERT INTO "impersonation_sessions" (platform_admin_id, tenant_id, target_user_id, role, status, entry_kind, reason)
       VALUES ($1, $2, $1, 'ADMIN', $3, $4, 'support') RETURNING id`,
      [adminId, schoolId, status, kind],
    );

  it('has the three tables, two audit columns, both indexes and the 16 audit values', async () => {
    for (const t of ['impersonation_sessions', 'platform_school_notes', 'platform_announcements']) {
      expect(await exists(t)).toBe(true);
    }
    const idx: { indexname: string }[] = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='audit_logs' AND indexname IN ('IDX_al_impersonation_session','IDX_al_tenant_created')`,
    );
    expect(idx).toHaveLength(2);
    const expected = [
      'IMPERSONATION_STARTED',
      'IMPERSONATION_ENDED',
      'SUPPORT_ACCESS_MODE_CHANGED',
      'SUPPORT_ACCESS_CONFIRMED',
      'SUPPORT_ACCESS_REQUESTED',
      'SUPPORT_ACCESS_APPROVED',
      'SUPPORT_ACCESS_DENIED',
      'PLATFORM_SCHOOL_NOTE_ADDED',
      'PLATFORM_SCHOOL_RENAMED',
      'PLATFORM_SCHOOL_ARCHIVED',
      'PLATFORM_ADMIN_RESET_SENT',
      'PLATFORM_SCHOOL_LOGOUT_ALL',
      'PLATFORM_USER_LOGOUT',
      'PLATFORM_ANNOUNCEMENT_SENT',
      'PLATFORM_QUEUE_RETRY',
      'PLATFORM_RESTORE_LOCK_RELEASED',
    ];
    // The ticket text says 17, but #3782 added exactly 16 values; assert the exact set.
    const vals: { enumlabel: string }[] = await ds.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid='public.audit_logs_action_enum'::regtype AND enumlabel = ANY($1)`,
      [expected],
    );
    expect(vals.map((v) => v.enumlabel).sort()).toEqual([...expected].sort());
  });

  it('CHECKs reject a bogus status, kind and a blank reason', async () => {
    await expect(newSession('BOGUS')).rejects.toThrow(/CHK_impersonation_sessions_status/);
    await expect(newSession('ACTIVE', 'BOGUS')).rejects.toThrow(
      /CHK_impersonation_sessions_entry_kind/,
    );
    await expect(
      ds.query(
        `INSERT INTO "impersonation_sessions" (platform_admin_id, tenant_id, target_user_id, role, status, entry_kind, reason)
         VALUES ($1, $2, $1, 'ADMIN', 'ACTIVE', 'NORMAL', '   ')`,
        [adminId, schoolId],
      ),
    ).rejects.toThrow(/CHK_impersonation_sessions_reason/);
  });

  it('keeps the audit trigger and RESTRICT FK, and an audit row survives down/up', async () => {
    const [s] = await newSession();
    const [row] = await ds.query(
      `INSERT INTO "audit_logs" (action, entity_type, impersonation_session_id, impersonated_by_platform_admin_id)
       VALUES ('IMPERSONATION_STARTED', 'ImpersonationSession', $1, $2) RETURNING id`,
      [s.id, adminId],
    );
    await expect(
      ds.query(`UPDATE "audit_logs" SET entity_type='x' WHERE id=$1`, [row.id]),
    ).rejects.toThrow();
    await expect(
      ds.query(`DELETE FROM "impersonation_sessions" WHERE id=$1`, [s.id]),
    ).rejects.toThrow(/foreign key|violates/i);

    // A row without the new columns must survive the round trip. The session-linked row must go
    // before down() drops the column; audit rows are write-only, so use a plain row instead.
    const [plain] = await ds.query(
      `INSERT INTO "audit_logs" (action, entity_type) VALUES ('LOGIN', 'User') RETURNING id`,
    );
    // Drop the FK-bound rows' blocker: down() only needs the columns gone, which works with data.
    // down() drops the session columns, so the session link on the first row is lost by design.
    await migration.down(qr);
    expect(await exists('impersonation_sessions')).toBe(false);
    await migration.up(qr);
    expect(await exists('impersonation_sessions')).toBe(true);
    const found = await ds.query(`SELECT id FROM "audit_logs" WHERE id=$1`, [plain.id]);
    expect(found).toHaveLength(1);
  });
});
