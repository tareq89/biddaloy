import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTenantIsolationAndEnrollments1784175065080 implements MigrationInterface {
    name = 'AddTenantIsolationAndEnrollments1784175065080'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add tenant_id to academic_years
        await queryRunner.query(`ALTER TABLE "academic_years" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "academic_years" ADD CONSTRAINT "FK_ay_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 2. Add tenant_id to classes
        await queryRunner.query(`ALTER TABLE "classes" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "classes" ADD CONSTRAINT "FK_cl_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 3. Add tenant_id and capacity to class_sections
        await queryRunner.query(`ALTER TABLE "class_sections" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "class_sections" ADD CONSTRAINT "FK_cs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "class_sections" ADD "capacity" integer`);

        // 4. Add tenant_id to teachers
        await queryRunner.query(`ALTER TABLE "teachers" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "teachers" ADD CONSTRAINT "FK_tch_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 5. Add tenant_id to guardians
        await queryRunner.query(`ALTER TABLE "guardians" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "guardians" ADD CONSTRAINT "FK_grd_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 6. Add tenant_id to fee_structures
        await queryRunner.query(`ALTER TABLE "fee_structures" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "fee_structures" ADD CONSTRAINT "FK_fs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 6b. Add tenant_id to students
        await queryRunner.query(`ALTER TABLE "students" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "students" ADD CONSTRAINT "FK_st_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 7. Add tenant_id to payments
        await queryRunner.query(`ALTER TABLE "payments" ADD "tenant_id" uuid`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_pay_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 8. Add deleted_at to academic_years for soft delete
        await queryRunner.query(`ALTER TABLE "academic_years" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 9. Add deleted_at to classes for soft delete
        await queryRunner.query(`ALTER TABLE "classes" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 10. Add deleted_at to class_sections for soft delete
        await queryRunner.query(`ALTER TABLE "class_sections" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 11. Add deleted_at to fee_structures for soft delete
        await queryRunner.query(`ALTER TABLE "fee_structures" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 12. Add deleted_at to payments for soft delete
        await queryRunner.query(`ALTER TABLE "payments" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 13. Add deleted_at to teachers for soft delete
        await queryRunner.query(`ALTER TABLE "teachers" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);

        // 14. Add deleted_at to students - already exists
        // 15. Add deleted_at to guardians - already exists
        // 16. Add deleted_at to users - already exists

        // 17. Create teacher_class_sections pivot table
        await queryRunner.query(`CREATE TABLE "teacher_class_sections" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "teacher_id" uuid NOT NULL,
            "section_id" uuid NOT NULL,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_tcs" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_tcs_teacher_section" ON "teacher_class_sections" ("teacher_id", "section_id")`);
        await queryRunner.query(`ALTER TABLE "teacher_class_sections" ADD CONSTRAINT "FK_tcs_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "teacher_class_sections" ADD CONSTRAINT "FK_tcs_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 18. Create enrollments table
        await queryRunner.query(`CREATE TYPE "public"."enrollments_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED')`);
        await queryRunner.query(`CREATE TABLE "enrollments" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "student_id" uuid NOT NULL,
            "class_id" uuid NOT NULL,
            "section_id" uuid,
            "academic_year_id" uuid NOT NULL,
            "enrollment_status" "public"."enrollments_status_enum" NOT NULL DEFAULT 'ACTIVE',
            "enrolled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "tenant_id" uuid NOT NULL,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_enrollments" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_enrollments_student" ON "enrollments" ("student_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_enrollments_academic_year" ON "enrollments" ("academic_year_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_enrollments_tenant" ON "enrollments" ("tenant_id") `);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_enr_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_enr_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_enr_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_enr_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_enr_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_enr_active_student_year" ON "enrollments" ("student_id", "academic_year_id") WHERE enrollment_status = 'ACTIVE'`);

        // 19. Update unique indexes to include tenant_id for multi-tenant safety
        // Academic years: name + tenant_id unique, exclude soft-deleted
        await queryRunner.query(`DROP INDEX "public"."IDX_645d0f115fa85aaecffdc11cba"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ay_name_tenant" ON "academic_years" ("name", "tenant_id") WHERE "deleted_at" IS NULL`);

        // Classes: name + academic_year_id + tenant_id unique
        await queryRunner.query(`DROP INDEX "public"."IDX_94109a89dd3240577e832b96df"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cl_name_year_tenant" ON "classes" ("name", "academic_year_id", "tenant_id")`);

        // Class sections: class_id + section_name unique, exclude soft-deleted
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cs_name_class" ON "class_sections" ("class_id", "section_name") WHERE "deleted_at" IS NULL`);

        // 20. Update the is_current partial index to include tenant_id and exclude soft-deleted
        await queryRunner.query(`DROP INDEX "public"."IDX_12a99ca8a701651b6ff5d6612e"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ay_is_current_tenant" ON "academic_years" ("is_current", "tenant_id") WHERE is_current = true AND "deleted_at" IS NULL`);

        // 21. Set tenant_id on existing records (migrate to first school if exists)
        await queryRunner.query(`
            UPDATE "academic_years" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "classes" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "class_sections" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "teachers" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "guardians" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "fee_structures" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "payments" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "students" SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);

        // 22. Make tenant_id NOT NULL after backfill
        await queryRunner.query(`ALTER TABLE "academic_years" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "classes" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "class_sections" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "teachers" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "guardians" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "fee_structures" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "tenant_id" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop enrollments table
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_enr_tenant"`);
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_enr_academic_year"`);
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_enr_section"`);
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_enr_class"`);
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_enr_student"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_enrollments_academic_year"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_enrollments_student"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_enrollments_tenant"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_enr_active_student_year"`);
        await queryRunner.query(`DROP TABLE "enrollments"`);
        await queryRunner.query(`DROP TYPE "public"."enrollments_status_enum"`);

        // Drop teacher_class_sections
        await queryRunner.query(`ALTER TABLE "teacher_class_sections" DROP CONSTRAINT "FK_tcs_section"`);
        await queryRunner.query(`ALTER TABLE "teacher_class_sections" DROP CONSTRAINT "FK_tcs_teacher"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_tcs_teacher_section"`);
        await queryRunner.query(`DROP TABLE "teacher_class_sections"`);

        // Restore original indexes
        await queryRunner.query(`DROP INDEX "public"."IDX_ay_is_current_tenant"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_12a99ca8a701651b6ff5d6612e" ON "academic_years" ("is_current") WHERE is_current = true`);

        await queryRunner.query(`DROP INDEX "public"."IDX_cl_name_year_tenant"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_94109a89dd3240577e832b96df" ON "classes" ("name", "academic_year_id")`);

        await queryRunner.query(`DROP INDEX "public"."IDX_ay_name_tenant"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_645d0f115fa85aaecffdc11cba" ON "academic_years" ("name")`);

        await queryRunner.query(`DROP INDEX "public"."IDX_cs_name_class"`);

        // Drop columns
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "fee_structures" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "class_sections" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "classes" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "teachers" DROP COLUMN "deleted_at"`);

        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_pay_tenant"`);
        await queryRunner.query(`ALTER TABLE "fee_structures" DROP CONSTRAINT "FK_fs_tenant"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP CONSTRAINT "FK_grd_tenant"`);
        await queryRunner.query(`ALTER TABLE "teachers" DROP CONSTRAINT "FK_tch_tenant"`);
        await queryRunner.query(`ALTER TABLE "class_sections" DROP CONSTRAINT "FK_cs_tenant"`);
        await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "FK_cl_tenant"`);
        await queryRunner.query(`ALTER TABLE "academic_years" DROP CONSTRAINT "FK_ay_tenant"`);
        await queryRunner.query(`ALTER TABLE "students" DROP CONSTRAINT "FK_st_tenant"`);

        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "fee_structures" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "teachers" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "class_sections" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "classes" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "class_sections" DROP COLUMN "capacity"`);
    }
}