import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [15.5.1] Schema for localized school identity, logo key, and per-document
 * issuer snapshots.
 *
 * - `schools.name_bn` / `schools.registration_id` (EIIN) / `schools.logo_key`
 *   — all nullable, no backfill; an existing school simply has none of
 *   these until an ADMIN fills them in via [15.5.2]/[15.5.3].
 * - `invoices.issuer_snapshot` / `payments.issuer_snapshot` — jsonb,
 *   nullable. A row created before this migration has no snapshot; reads
 *   fall back to the live school profile (see [15.5.5]'s `resolveIssuer`).
 *
 * Rollback: `down` drops all five columns. This is destructive for any
 * `issuer_snapshot` already captured — acceptable because those rows fall
 * back to the live profile on read regardless, so nothing becomes
 * unreadable, only less precisely dated.
 */
export class AddSchoolProfileAndIssuerSnapshot1789000000000 implements MigrationInterface {
  name = 'AddSchoolProfileAndIssuerSnapshot1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ADD "name_bn" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "registration_id" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "logo_key" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "invoices" ADD "issuer_snapshot" jsonb`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "issuer_snapshot" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "issuer_snapshot"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "issuer_snapshot"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "logo_key"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "registration_id"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "name_bn"`);
  }
}
