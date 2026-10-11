import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [68.1.#2218] A school can no longer attach someone's existing account on its
 * own: it files a `JOIN_SCHOOL` request (an `auth_tokens` row) that the account
 * owner accepts. `AuthTokenPurpose.JOIN_SCHOOL` is new in `@biddaloy/shared`.
 * `ADD VALUE IF NOT EXISTS` is safe to run twice.
 */
export class AddJoinSchoolAuthTokenPurpose1791700000000 implements MigrationInterface {
  name = 'AddJoinSchoolAuthTokenPurpose1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."auth_tokens_purpose_enum" ADD VALUE IF NOT EXISTS 'JOIN_SCHOOL'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; left as a documented no-op,
    // same convention as AddLateFeeTypeEnumValue1789800009500.
  }
}
