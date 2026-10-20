import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { StudentFeeMoneyChecks1791900000300 } from '../src/migrations/1791900000300-StudentFeeMoneyChecks';

/**
 * [2636, D23] Runs the money-checks migration's `down`/`up` directly against the (already
 * migrated) test database. The constraints are NOT VALID: rows that already break the rule stay,
 * new rows that break it are refused with SQLSTATE 23514.
 */
describe('StudentFeeMoneyChecks1791900000300 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new StudentFeeMoneyChecks1791900000300();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    // A failed up() must not leave later spec files on this worker without the constraints.
    await dataSource.query(
      `ALTER TABLE student_fees DROP CONSTRAINT IF EXISTS "CHK_sf_waived_settled"`,
    );
    await dataSource.query(
      `ALTER TABLE student_fees DROP CONSTRAINT IF EXISTS "CHK_sf_paid_plus_discount"`,
    );
    await migration.up(queryRunner);
    await queryRunner.release();
    await dataSource.destroy();
  });

  /** Raw insert; FK triggers are off so random parent ids are accepted (CHECKs still run). */
  const insertFee = (
    offset: number,
    total: number,
    paid: number,
    discount: number,
    status: string,
  ) =>
    dataSource.query(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
                                 total_amount, paid_amount, discount_amount, one_off_discount_amount, status)
       VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), (date '2020-01-01' + $1::int), 'MONTH',
               $2, $3, $4, $4, $5::student_fees_status_enum)`,
      [offset, total, paid, discount, status],
    );

  const constraints = async (): Promise<string[]> =>
    (
      await dataSource.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'student_fees'::regclass AND conname IN ('CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled')
          ORDER BY conname`,
      )
    ).map((r: { conname: string }) => r.conname);

  it('down() drops both checks; an over-paid and a WAIVED-with-no-discount row then insert', async () => {
    await dataSource.query(`ALTER TABLE student_fees DISABLE TRIGGER ALL`);
    try {
      await migration.down(queryRunner);
      expect(await constraints()).toEqual([]);
      await insertFee(1, 100, 150, 0, 'PAID');
      await insertFee(2, 100, 0, 0, 'WAIVED');
    } finally {
      await dataSource.query(`ALTER TABLE student_fees ENABLE TRIGGER ALL`);
    }
  });

  it('up() adds both checks NOT VALID: old bad rows stay, new bad rows get 23514, a settled WAIVED passes', async () => {
    await dataSource.query(`ALTER TABLE student_fees DISABLE TRIGGER ALL`);
    try {
      await migration.up(queryRunner);
      expect(await constraints()).toEqual(['CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled']);
      const notValid = await dataSource.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'student_fees'::regclass
            AND conname IN ('CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled') AND NOT convalidated`,
      );
      expect(notValid).toHaveLength(2);

      await expect(insertFee(3, 100, 150, 0, 'PAID')).rejects.toMatchObject({ code: '23514' });
      await expect(insertFee(4, 100, 0, 0, 'WAIVED')).rejects.toMatchObject({ code: '23514' });
      await insertFee(5, 100, 0, 100, 'WAIVED'); // discount = total: valid
      await insertFee(6, 100, 60, 40, 'PAID'); // paid + discount = total: valid
    } finally {
      await dataSource.query(
        `DELETE FROM student_fees WHERE period_start BETWEEN date '2020-01-02' AND date '2020-01-07'`,
      );
      await dataSource.query(`ALTER TABLE student_fees ENABLE TRIGGER ALL`);
    }
  });

  it('is back in the up state for later spec files (down then up round-trips)', async () => {
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    expect(await constraints()).toEqual(['CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled']);
  });
});
