import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [58.0.01] (D10/D11) The same User may hold one Teacher / Guardian / Student /
 * StaffProfile row per school. The four `user_id` keys were global, so a person
 * working or studying in two schools could not have a profile in both; the same
 * goes for `teachers.employee_id`.
 *
 * Each global key becomes a per-tenant unique index. Soft-deletable tables
 * (`teachers`, `guardians`, `students`) ignore soft-deleted rows; `staff_profiles`
 * has no `deleted_at`. The global keys were also the only index on `user_id`, so a
 * plain index replaces them for FK / lookup speed.
 */
type Spec = {
  table: string;
  oldKey: string;
  uq: string;
  idx: string;
  nullableUser: boolean;
  softDelete: boolean;
};

const USER_KEYS: Spec[] = [
  {
    table: 'teachers',
    oldKey: 'REL_4668d4752e6766682d1be0b346',
    uq: 'UQ_teachers_tenant_user',
    idx: 'IDX_teachers_user_id',
    nullableUser: false,
    softDelete: true,
  },
  {
    table: 'guardians',
    oldKey: 'REL_f1d05a3a2d70db0a25479b6718',
    uq: 'UQ_guardians_tenant_user',
    idx: 'IDX_guardians_user_id',
    nullableUser: true,
    softDelete: true,
  },
  {
    table: 'students',
    oldKey: 'REL_fb3eff90b11bddf7285f9b4e28',
    uq: 'UQ_students_tenant_user',
    idx: 'IDX_students_user_id',
    nullableUser: true,
    softDelete: true,
  },
  {
    table: 'staff_profiles',
    oldKey: 'UQ_staff_profiles_user',
    uq: 'UQ_staff_profiles_tenant_user',
    idx: 'IDX_staff_profiles_user_id',
    nullableUser: false,
    softDelete: false,
  },
];

const wherePredicate = (s: Spec, col: string) =>
  [s.nullableUser && `"${col}" IS NOT NULL`, s.softDelete && `"deleted_at" IS NULL`]
    .filter(Boolean)
    .join(' AND ');

export class PerTenantProfileUniqueness1791900000000 implements MigrationInterface {
  name = 'PerTenantProfileUniqueness1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const s of USER_KEYS) {
      const where = wherePredicate(s, 'user_id');
      await queryRunner.query(`ALTER TABLE "${s.table}" DROP CONSTRAINT "${s.oldKey}"`);
      await queryRunner.query(
        `CREATE UNIQUE INDEX "${s.uq}" ON "${s.table}" ("tenant_id", "user_id")${where ? ` WHERE ${where}` : ''}`,
      );
      await queryRunner.query(`CREATE INDEX "${s.idx}" ON "${s.table}" ("user_id")`);
    }
    await queryRunner.query(
      `ALTER TABLE "teachers" DROP CONSTRAINT "UQ_41a9b4d0b9007c9630463244316"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_teachers_tenant_employee_id" ON "teachers" ("tenant_id", "employee_id") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-adding a global key would fail half-way (or force deleting rows) if a
    // user / employee id now lives in more than one tenant: refuse up front.
    const checks: [table: string, col: string][] = [
      ...USER_KEYS.map((s): [string, string] => [s.table, 'user_id']),
      ['teachers', 'employee_id'],
    ];
    for (const [table, col] of checks) {
      const dupes = await queryRunner.query(
        `SELECT "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL GROUP BY "${col}" HAVING count(*) > 1`,
      );
      if (dupes.length > 0) {
        throw new Error(
          `Cannot revert PerTenantProfileUniqueness: ${dupes.length} ${table}.${col} value(s) appear on more than one row (another tenant, or a soft-deleted row). Delete the extra rows first.`,
        );
      }
    }

    await queryRunner.query(`DROP INDEX "UQ_teachers_tenant_employee_id"`);
    await queryRunner.query(
      `ALTER TABLE "teachers" ADD CONSTRAINT "UQ_41a9b4d0b9007c9630463244316" UNIQUE ("employee_id")`,
    );
    for (const s of USER_KEYS) {
      await queryRunner.query(`DROP INDEX "${s.idx}"`);
      await queryRunner.query(`DROP INDEX "${s.uq}"`);
      await queryRunner.query(
        `ALTER TABLE "${s.table}" ADD CONSTRAINT "${s.oldKey}" UNIQUE ("user_id")`,
      );
    }
  }
}
