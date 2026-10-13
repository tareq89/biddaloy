import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [75.2] `users.tokens_valid_after`: an access token issued before this moment
 * is refused (see JwtStrategy). NULL means "no cut-off", so no backfill.
 * `down` drops only this column.
 */
export class AddUsersTokensValidAfter1791805000400 implements MigrationInterface {
  name = 'AddUsersTokensValidAfter1791805000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "tokens_valid_after" timestamptz NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tokens_valid_after"`);
  }
}
