import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [788] Adds `results.section_id`/`section_position` (D2: the section the
 * student sat the exam in, snapshotted at compute, plus their merit rank
 * within that section) and the two promotion-workflow tables,
 * `promotion_runs` and `promotion_entries` (D6, D11, D13, D15, D16, D23,
 * D24). Entities/services for the promotion tables land in later waves —
 * this migration only creates schema and registers `PromotionsModule` with
 * `TypeOrmModule.forFeature` for the two new entities.
 */
export class AddPromotionsAndSectionRank1789800014000 implements MigrationInterface {
  name = 'AddPromotionsAndSectionRank1789800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- results: section_id / section_position ---------------------------
    await queryRunner.query(`ALTER TABLE "results" ADD "section_id" uuid`);
    await queryRunner.query(`ALTER TABLE "results" ADD "section_position" int`);
    await queryRunner.query(
      `ALTER TABLE "results" ADD CONSTRAINT "FK_results_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_results_exam_section" ON "results" ("exam_id", "section_id")`,
    );

    // Backfill (D23), only rows not soft-deleted. section_id comes from the
    // student's ACTIVE enrollment in the exam's class/year at backfill time.
    await queryRunner.query(`
      UPDATE "results" r
      SET "section_id" = e."section_id"
      FROM "exams" x, "enrollments" e
      WHERE r."exam_id" = x."id"
        AND e."student_id" = r."student_id"
        AND e."academic_year_id" = x."academic_year_id"
        AND e."class_id" = x."class_id"
        AND e."enrollment_status" = 'ACTIVE'
        AND r."deleted_at" IS NULL
    `);

    // section_position: merit rank within (exam_id, section_id), restarting
    // at 1 per section. Only non-failing rows with a resolved section are
    // ranked; `position` (the whole-exam rank) is left untouched.
    await queryRunner.query(`
      UPDATE "results" r
      SET "section_position" = ranked."rank"
      FROM (
        SELECT "id", RANK() OVER (
          PARTITION BY "exam_id", "section_id"
          ORDER BY "gpa" DESC, "total_marks" DESC
        ) AS "rank"
        FROM "results"
        WHERE "deleted_at" IS NULL AND "is_fail" = false AND "section_id" IS NOT NULL
      ) ranked
      WHERE r."id" = ranked."id"
    `);

    // --- promotion_runs -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "promotion_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source_class_id" uuid NOT NULL,
        "source_academic_year_id" uuid NOT NULL,
        "target_academic_year_id" uuid NOT NULL,
        "target_class_id" uuid,
        "exam_ids" uuid[] NOT NULL,
        "algorithm" varchar(30) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
        "refreshed_at" timestamptz NOT NULL DEFAULT now(),
        "committed_at" timestamptz,
        "committed_by_user_id" uuid,
        "approved_by_user_id" uuid,
        "override_count" int NOT NULL DEFAULT 0,
        "created_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_runs_tenant" ON "promotion_runs" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_promotion_runs_committed_unique" ON "promotion_runs" ("tenant_id", "source_class_id", "target_academic_year_id") WHERE "status" = 'COMMITTED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" ADD CONSTRAINT "FK_promotion_runs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" ADD CONSTRAINT "FK_promotion_runs_source_class" FOREIGN KEY ("source_class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- promotion_entries ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "promotion_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "source_enrollment_id" uuid NOT NULL,
        "source_section_id" uuid,
        "merit_rank" int,
        "mean_gpa" numeric(4,2),
        "total_marks_sum" numeric(10,2),
        "passed_all" boolean NOT NULL,
        "suggested_outcome" varchar(20) NOT NULL,
        "final_outcome" varchar(20) NOT NULL,
        "is_override" boolean NOT NULL DEFAULT false,
        "override_note" text,
        "overridden_by_user_id" uuid,
        "group_name" varchar(100),
        "target_class_id" uuid,
        "target_section_id" uuid,
        "new_roll_number" int,
        "placement_error" varchar(500),
        "target_enrollment_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_promotion_entries_override_note" CHECK (NOT "is_override" OR ("override_note" IS NOT NULL AND length(btrim("override_note", E' \t\r\n')) > 0))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_promotion_entries_run_student" ON "promotion_entries" ("run_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_entries_tenant" ON "promotion_entries" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_entries_override" ON "promotion_entries" ("tenant_id", "student_id") WHERE "is_override" = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_entries" ADD CONSTRAINT "FK_promotion_entries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_entries" ADD CONSTRAINT "FK_promotion_entries_run" FOREIGN KEY ("run_id") REFERENCES "promotion_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promotion_entries" DROP CONSTRAINT "FK_promotion_entries_run"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_entries" DROP CONSTRAINT "FK_promotion_entries_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "promotion_entries"`);

    await queryRunner.query(
      `ALTER TABLE "promotion_runs" DROP CONSTRAINT "FK_promotion_runs_source_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" DROP CONSTRAINT "FK_promotion_runs_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "promotion_runs"`);

    await queryRunner.query(`DROP INDEX "IDX_results_exam_section"`);
    await queryRunner.query(`ALTER TABLE "results" DROP CONSTRAINT "FK_results_section"`);
    await queryRunner.query(`ALTER TABLE "results" DROP COLUMN "section_position"`);
    await queryRunner.query(`ALTER TABLE "results" DROP COLUMN "section_id"`);
  }
}
