import { MigrationInterface, QueryRunner } from 'typeorm';

/** [#3462] A grading-scale edit looks up the finals using the scale by (tenant_id, grading_scale_id). */
export class FinalResultRowsScaleIndex1792400000000 implements MigrationInterface {
  name = 'FinalResultRowsScaleIndex1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_final_result_rows_tenant_scale" ON "final_result_rows" ("tenant_id", "grading_scale_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_final_result_rows_tenant_scale"`);
  }
}
