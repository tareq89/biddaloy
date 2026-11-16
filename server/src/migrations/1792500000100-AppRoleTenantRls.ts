import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#3949, Epic 59 D3/D12/D14/D21/D22] The app now connects as `biddaloy_app`, a role that is not
 * the table owner, not a superuser and cannot bypass row-level security. Five tables carry a
 * database tenant wall, so SQL that forgot its `tenant_id` still sees only one school:
 * `students`, `guardians`, `payments`, `invoices`, `student_fees`.
 *
 * - The role has no password here: the runbook sets it (`ALTER ROLE biddaloy_app PASSWORD ...`).
 *   A migration never holds a secret.
 * - The role is cluster-wide: created once, tolerant of two databases migrating at the same
 *   moment. `down()` never drops it (other databases still hold grants to it).
 * - Policy `app_tenant_wall` is `TO biddaloy_app` only. A set `app.tenant_id` walls the rows; an
 *   unset or reset (`''`) one passes everything (D22: platform routes, queue jobs, the cockpit
 *   read across schools). `NULLIF(..., '')` because `''::uuid` would throw.
 * - `FORCE ROW LEVEL SECURITY` makes the table owner subject to RLS as well; only a superuser or a
 *   BYPASSRLS role skips it. No policy names the owner, so a non-superuser owner sees no rows:
 *   migrations, backups and jobs must run as the (superuser) owner, as the stack does today.
 * - `student_fees` has no `tenant_id`: its policy asks the student (as ReportReaderRls does).
 * - `report_reader` policies are untouched; `biddaloy_app` is a member so the report runner's
 *   `SET LOCAL ROLE report_reader` keeps working.
 * - A table a later migration creates is reachable through default privileges.
 */
export class AppRoleTenantRls1792500000100 implements MigrationInterface {
  name = 'AppRoleTenantRls1792500000100';

  private static readonly WITH_TENANT = ['students', 'guardians', 'payments', 'invoices'] as const;

  private static pred(col: string): string {
    const v = "NULLIF(current_setting('app.tenant_id', true), '')";
    return `(${v} IS NULL OR ${col} = ${v}::uuid)`;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE ROLE biddaloy_app LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END
      $$`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO biddaloy_app`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO biddaloy_app`,
    );
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO biddaloy_app`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO biddaloy_app', current_user);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO biddaloy_app', current_user);
      END $$`);
    // Needs report_reader to exist (ReportReaderRls runs earlier). NOINHERIT: SET ROLE only.
    await queryRunner.query(`GRANT report_reader TO biddaloy_app`);

    for (const table of AppRoleTenantRls1792500000100.WITH_TENANT) {
      await this.wall(queryRunner, table, AppRoleTenantRls1792500000100.pred('"tenant_id"'));
    }
    await this.wall(
      queryRunner,
      'student_fees',
      `EXISTS (SELECT 1 FROM "students" s WHERE s."id" = "student_fees"."student_id" AND ${AppRoleTenantRls1792500000100.pred('s."tenant_id"')})`,
    );
  }

  private async wall(queryRunner: QueryRunner, table: string, using: string): Promise<void> {
    await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS "app_tenant_wall" ON "${table}"`);
    await queryRunner.query(
      `CREATE POLICY "app_tenant_wall" ON "${table}" FOR ALL TO biddaloy_app USING (${using}) WITH CHECK (${using})`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const all = [...AppRoleTenantRls1792500000100.WITH_TENANT, 'student_fees'];
    for (const table of all) {
      await queryRunner.query(`DROP POLICY IF EXISTS "app_tenant_wall" ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      // report_reader policies need RLS to stay on for the tables ReportReaderRls walled.
      if (!['students', 'guardians', 'payments', 'student_fees'].includes(table)) {
        await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      }
    }
    await queryRunner.query(`
      DO $$ BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM biddaloy_app', current_user);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM biddaloy_app', current_user);
      END $$`);
    await queryRunner.query(`REVOKE report_reader FROM biddaloy_app`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM biddaloy_app`);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM biddaloy_app`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM biddaloy_app`);
    // The role itself stays: other databases on this cluster still hold grants to it.
  }
}
