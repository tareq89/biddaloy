import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `FeeStructure` becomes a price tag: `name`, `fee_type`, `amount`,
 * `academic_year_id`, and an optional `class_id`/`section_id` label.
 * Nothing on it decides who gets billed or when any more, so this drops:
 *
 * - the `fee_structure_students` pivot table entirely (SELECTED-applicability
 *   student targeting)
 * - `fee_structures.month`, `is_recurring`, `applicability`
 * - the `NOT NULL` constraint on `fee_structures.class_id` (a structure can
 *   now be school-wide)
 *
 * and replaces the old `(class_id, fee_type, month)` index — meaningless
 * once `month` is gone and `class_id` can be null — with
 * `(tenant_id, academic_year_id, fee_type)`, which matches how the service
 * now actually filters.
 *
 * It also soft-deletes duplicate rows that only differed by `month` (the
 * normal shape for a recurring monthly fee, and now indistinguishable once
 * `month` drops out of the workbook tab's natural key) — see the comment on
 * the dedup query in `up()`.
 */
export class FeeStructurePriceTag1789800000000 implements MigrationInterface {
  name = 'FeeStructurePriceTag1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pivot table first — it FKs into fee_structures.
    await queryRunner.query(`DROP TABLE "fee_structure_students"`);

    // Old index referenced `month`, which is about to be dropped.
    await queryRunner.query(`DROP INDEX "public"."IDX_ab5ec41d9b29b41a3959177bef"`);

    // The workbook tab's natural key also drops `month`
    // (class|year|section|type|month|name -> class|year|section|type|name),
    // so any pre-existing rows that only differed by month — the normal
    // shape for a recurring monthly fee — now collide on the same key. Keep
    // the earliest such row per key and soft-delete the rest *before*
    // dropping `month`, so the workbook's `deleteByAbsence` never gets a
    // chance to pick an arbitrary loser on the first post-migration export.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY tenant_id, academic_year_id, COALESCE(class_id::text, ''),
                       COALESCE(section_id::text, ''), fee_type, name
          ORDER BY month ASC, created_at ASC
        ) AS rn
        FROM "fee_structures"
        WHERE deleted_at IS NULL
      )
      UPDATE "fee_structures"
      SET deleted_at = NOW()
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `);

    await queryRunner.query(
      `ALTER TABLE "fee_structures" DROP COLUMN "month", DROP COLUMN "is_recurring", DROP COLUMN "applicability"`,
    );
    await queryRunner.query(`DROP TYPE "public"."fee_structures_applicability_enum"`);

    await queryRunner.query(`ALTER TABLE "fee_structures" ALTER COLUMN "class_id" DROP NOT NULL`);

    await queryRunner.query(
      `CREATE INDEX "IDX_fee_structures_tenant_year_type" ON "fee_structures" ("tenant_id", "academic_year_id", "fee_type")`,
    );
  }

  /**
   * Rollback note: this restores the columns and the pivot table, but NOT
   * the original per-row data. `month`, `is_recurring`, and `applicability`
   * are recreated with defaults (`month = 1`, `is_recurring = true`,
   * `applicability = 'ALL'`) for every existing row, and
   * `fee_structure_students` comes back empty. Whatever those columns
   * actually held before `up()` ran is gone — this only restores the shape,
   * not the state.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_structures_tenant_year_type"`);

    // `class_id` cannot go back to NOT NULL if any school-wide (null-class)
    // structure was created after `up()` ran — that's the whole point of
    // this migration, so it will usually be true. There is no class to
    // backfill it with (a wrong one would silently reassign fees to the
    // wrong class), so refuse with a clear message instead of letting
    // Postgres fail this whole rollback with a generic constraint error.
    const [{ null_count: nullCount }] = await queryRunner.query(
      `SELECT COUNT(*) AS null_count FROM "fee_structures" WHERE "class_id" IS NULL`,
    );
    if (Number(nullCount) > 0) {
      throw new Error(
        `Cannot roll back FeeStructurePriceTag: ${nullCount} fee_structures row(s) ` +
          `have a null class_id (school-wide structures created after this migration ` +
          `ran). There is no class to backfill them with, and Postgres's SET NOT NULL ` +
          `rejects a null class_id even on soft-deleted rows. Reassign those rows to a ` +
          `real class_id, or hard-delete them, before rolling back.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "fee_structures" ALTER COLUMN "class_id" SET NOT NULL`);

    await queryRunner.query(
      `CREATE TYPE "public"."fee_structures_applicability_enum" AS ENUM('ALL', 'SELECTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_structures" ADD "applicability" "public"."fee_structures_applicability_enum" NOT NULL DEFAULT 'ALL'`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_structures" ADD "is_recurring" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE "fee_structures" ADD "month" integer NOT NULL DEFAULT 1`);
    // Drop the temporary default now that every existing row has a value —
    // new rows must set it explicitly, matching the pre-drop schema.
    await queryRunner.query(`ALTER TABLE "fee_structures" ALTER COLUMN "month" DROP DEFAULT`);

    await queryRunner.query(
      `CREATE INDEX "IDX_ab5ec41d9b29b41a3959177bef" ON "fee_structures" ("class_id", "fee_type", "month")`,
    );

    await queryRunner.query(
      `CREATE TABLE "fee_structure_students" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fee_structure_id" uuid NOT NULL, "student_id" uuid NOT NULL, CONSTRAINT "PK_6f6400fc17ec79ced2445758c71" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_54a89691bc959d500a12e54304" ON "fee_structure_students" ("fee_structure_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_structure_students" ADD CONSTRAINT "FK_2d58bce35698f9ef3ae53f25ad5" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_structure_students" ADD CONSTRAINT "FK_0bba5c26c81b56fabfc8246901e" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
