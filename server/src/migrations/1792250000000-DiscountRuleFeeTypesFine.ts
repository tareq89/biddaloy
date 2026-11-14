import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#2343] `FeeType.FINE` is in the shared enum and the entity, but the DB enum type behind
 * `discount_rules.fee_types` lacked it, so saving a rule that targets fines failed with
 * "invalid input value for enum". `ADD VALUE IF NOT EXISTS` is safe to run twice.
 */
export class DiscountRuleFeeTypesFine1792250000000 implements MigrationInterface {
  name = 'DiscountRuleFeeTypesFine1792250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."discount_rules_fee_types_enum" ADD VALUE IF NOT EXISTS 'FINE'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; documented no-op.
  }
}
