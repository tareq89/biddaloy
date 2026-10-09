import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [35.1.7/#1299] Subject choice groups (D42/D43): `class_subjects.choice_group`
 * ("exactly one of" set) and a trigger-owned copy on `student_subject_choices`
 * so a partial unique index can enforce one pick per student+year+group.
 *
 * Safe on populated tables: both columns are nullable, no backfill, so every
 * existing row stays NULL and both CHECKs/the index trivially hold.
 *
 * Accepted DB-enforced edge cases of the rename cascade trigger
 * (`trg_cs_cascade_choice_group`): renaming/assigning a group on a class
 * subject that already has an `is_fourth = true` pick raises 23514, and a
 * rename that merges two groups where one student picked from both raises
 * 23505. The whole UPDATE on `class_subjects` rolls back in both cases.
 *
 * Constraint/index names + SQL are redeclared in the entities (the schema
 * builder drops anything not in entity metadata) — keep both in sync.
 */
export class SubjectChoiceGroups1791100000000 implements MigrationInterface {
  name = 'SubjectChoiceGroups1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "class_subjects" ADD COLUMN "choice_group" varchar(50)`);
    await queryRunner.query(
      `ALTER TABLE "class_subjects" ADD CONSTRAINT "CHK_class_subjects_choice_group_exclusive" CHECK ("choice_group" IS NULL OR (btrim("choice_group") <> '' AND "is_optional" = false AND "group_name" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD COLUMN "choice_group" varchar(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD CONSTRAINT "CHK_student_subject_choices_group_not_fourth" CHECK ("choice_group" IS NULL OR "is_fourth" = false)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_student_subject_choices_one_per_choice_group" ON "student_subject_choices" ("student_id", "academic_year_id", "choice_group") WHERE "choice_group" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "public"."ssc_copy_choice_group"() RETURNS TRIGGER AS $$
      DECLARE cs RECORD;
      BEGIN
        SELECT tenant_id, choice_group INTO cs FROM class_subjects WHERE id = NEW.class_subject_id;
        IF cs.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
          RAISE EXCEPTION 'student_subject_choices tenant mismatch';
        END IF;
        NEW.choice_group := cs.choice_group;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "trg_ssc_copy_choice_group" BEFORE INSERT OR UPDATE OF class_subject_id, choice_group ON "student_subject_choices" FOR EACH ROW EXECUTE FUNCTION "public"."ssc_copy_choice_group"()`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "public"."cs_cascade_choice_group"() RETURNS TRIGGER AS $$
      BEGIN
        UPDATE student_subject_choices SET choice_group = NEW.choice_group WHERE class_subject_id = NEW.id;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "trg_cs_cascade_choice_group" AFTER UPDATE OF choice_group ON "class_subjects" FOR EACH ROW WHEN (OLD.choice_group IS DISTINCT FROM NEW.choice_group) EXECUTE FUNCTION "public"."cs_cascade_choice_group"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_cs_cascade_choice_group" ON "class_subjects"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "public"."cs_cascade_choice_group"()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_ssc_copy_choice_group" ON "student_subject_choices"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "public"."ssc_copy_choice_group"()`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_student_subject_choices_one_per_choice_group"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" DROP CONSTRAINT "CHK_student_subject_choices_group_not_fourth"`,
    );
    await queryRunner.query(`ALTER TABLE "student_subject_choices" DROP COLUMN "choice_group"`);
    await queryRunner.query(
      `ALTER TABLE "class_subjects" DROP CONSTRAINT "CHK_class_subjects_choice_group_exclusive"`,
    );
    await queryRunner.query(`ALTER TABLE "class_subjects" DROP COLUMN "choice_group"`);
  }
}
