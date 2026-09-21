import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [20.1.1] `grading_scales` (percent-to-grade band sets, one per tenant
 * per academic year, with optional per-class overrides) and its child
 * `grading_bands`. Also adds `is_graded_only` to `class_subjects` —
 * marks a subject that only ever gets a pass/fail-style grade, never a
 * numeric mark (D5).
 *
 * "One default scale per year" (`class_id IS NULL`) needs a partial
 * unique index, not a plain unique constraint: Postgres treats NULLs as
 * distinct, so a plain constraint on (tenant_id, academic_year_id,
 * class_id) would let multiple default rows coexist. Follows
 * `1789800007000-StudentFeesPartialUniqueIndex.ts`'s pattern. Per-class
 * overrides use a separate plain unique index, since `class_id` is
 * never null there.
 */
export class AddGradingScales1789800011000 implements MigrationInterface {
  name = 'AddGradingScales1789800011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "grading_scales" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "class_id" uuid,
        "name" varchar(200) NOT NULL,
        "revision" int NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_grading_scales" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_grading_scales_tenant_year" ON "grading_scales" ("tenant_id", "academic_year_id")`,
    );
    // One default (class_id IS NULL) scale per (tenant, year).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_grading_scales_default_per_year" ON "grading_scales" ("tenant_id", "academic_year_id") WHERE "class_id" IS NULL AND "deleted_at" IS NULL`,
    );
    // One override scale per (tenant, year, class).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_grading_scales_class_override" ON "grading_scales" ("tenant_id", "academic_year_id", "class_id") WHERE "class_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_scales" ADD CONSTRAINT "FK_grading_scales_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_scales" ADD CONSTRAINT "FK_grading_scales_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_scales" ADD CONSTRAINT "FK_grading_scales_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "grading_bands" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "scale_id" uuid NOT NULL,
        "percent_from" int NOT NULL,
        "percent_to" int NOT NULL,
        "grade" varchar(10) NOT NULL,
        "gpa" numeric(4,2),
        "is_fail" boolean NOT NULL DEFAULT false,
        "sequence" int NOT NULL,
        "comment" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_grading_bands" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_grading_bands_tenant_scale" ON "grading_bands" ("tenant_id", "scale_id")`,
    );
    // A scale's bands must not share a display order (D-earlier plan step 3).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_grading_bands_scale_sequence" ON "grading_bands" ("scale_id", "sequence")`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_bands" ADD CONSTRAINT "FK_grading_bands_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_bands" ADD CONSTRAINT "FK_grading_bands_scale" FOREIGN KEY ("scale_id") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "class_subjects" ADD "is_graded_only" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "class_subjects" DROP COLUMN "is_graded_only"`);

    await queryRunner.query(`ALTER TABLE "grading_bands" DROP CONSTRAINT "FK_grading_bands_scale"`);
    await queryRunner.query(
      `ALTER TABLE "grading_bands" DROP CONSTRAINT "FK_grading_bands_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "grading_bands"`);

    await queryRunner.query(
      `ALTER TABLE "grading_scales" DROP CONSTRAINT "FK_grading_scales_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_scales" DROP CONSTRAINT "FK_grading_scales_academic_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grading_scales" DROP CONSTRAINT "FK_grading_scales_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "grading_scales"`);
  }
}
