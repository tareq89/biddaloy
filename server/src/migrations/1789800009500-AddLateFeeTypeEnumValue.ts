import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.7.3]/#677, consumed again by [16.7.4]/#678 — `FeeType.LATE_FEE` has
 * existed in `@biddaloy/shared`'s enum since Epic 16 wave 3 (#650), but no
 * migration ever added it to the database's `fee_structures_fee_type_enum`
 * type, so a real `LATE_FEE` `FeeStructure` row could never be inserted.
 * #677's `DiscountResolver` needs one to test "never discounts a
 * LATE_FEE-type bill" against; #678's daily late-fee sweep needs one to
 * actually generate late-fee bills against. `ADD VALUE IF NOT EXISTS` is
 * safe to run twice, so this doesn't collide if #678 also touches it.
 */
export class AddLateFeeTypeEnumValue1789800009500 implements MigrationInterface {
  name = 'AddLateFeeTypeEnumValue1789800009500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."fee_structures_fee_type_enum" ADD VALUE IF NOT EXISTS 'LATE_FEE'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; a `down` here would need to
    // recreate the whole type and every dependent column, which risks data
    // loss for a rollback that isn't expected to run in practice. Left as
    // a documented no-op, same convention as other enum-additive migrations
    // in this codebase.
  }
}
