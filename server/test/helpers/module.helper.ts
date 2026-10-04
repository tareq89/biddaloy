import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TeacherStaffProfileSubscriber } from '../../src/modules/staff-profiles/teacher-staff-profile.subscriber';

/**
 * Creates a NestJS testing module connected to the test database.
 *
 * @param entities - Array of entity classes to register
 * @param providers - Array of providers (services, etc.) to register
 * @param imports - Additional imports
 * @param options - Optional configuration
 * @param options.synchronize - Whether to auto-create schema (default: false)
 * @param options.dropSchema - Whether to drop schema before sync (default: false)
 * @returns A configured TestingModule
 */
export async function createTestModule(
  entities: any[],
  providers: any[],
  imports: any[] = [],
  options?: { synchronize?: boolean; dropSchema?: boolean },
): Promise<TestingModule> {
  const testModule = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities,
        subscribers: [TeacherStaffProfileSubscriber],
        synchronize: options?.synchronize ?? false,
        dropSchema: options?.dropSchema ?? false,
        logging: false,
      }),
      TypeOrmModule.forFeature(entities),
      ...imports,
    ],
    providers,
  }).compile();

  // `synchronize` builds the schema from entities, so migration-only
  // objects are missing. Recreate the one that app code relies on: inserts
  // that omit `teacher_class_sections.assignment_type` get it inferred
  // (see `TeacherAssignmentType1791300000000`).
  if (options?.synchronize) {
    const ds = testModule.get<DataSource>(getDataSourceToken());
    const [{ exists }] = await ds.query(
      `SELECT to_regclass('teacher_class_sections') IS NOT NULL AS exists`,
    );
    if (exists) {
      await ds.query(`
        CREATE OR REPLACE FUNCTION "tcs_default_assignment_type"() RETURNS trigger AS $$
        BEGIN
          IF NEW."assignment_type" IS NULL THEN
            NEW."assignment_type" := CASE WHEN NEW."subject_id" IS NULL
              THEN 'CLASS_TEACHER'::teacher_assignment_type
              ELSE 'SUBJECT_TEACHER'::teacher_assignment_type END;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await ds.query(
        `DROP TRIGGER IF EXISTS "TRG_tcs_default_assignment_type" ON "teacher_class_sections"`,
      );
      await ds.query(
        `CREATE TRIGGER "TRG_tcs_default_assignment_type" BEFORE INSERT ON "teacher_class_sections" FOR EACH ROW EXECUTE FUNCTION "tcs_default_assignment_type"()`,
      );
      // D2 — and the constraints that migration adds (`@Index` cannot
      // express them), so a synchronize-built schema enforces the same rules.
      await ds.query(
        `ALTER TABLE "teacher_class_sections" DROP CONSTRAINT IF EXISTS "CK_tcs_subject_matches_type"`,
      );
      await ds.query(
        `ALTER TABLE "teacher_class_sections" ADD CONSTRAINT "CK_tcs_subject_matches_type" CHECK (("assignment_type" = 'SUBJECT_TEACHER') = ("subject_id" IS NOT NULL))`,
      );
      await ds.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tcs_section_class_teacher" ON "teacher_class_sections" ("section_id") WHERE "assignment_type" = 'CLASS_TEACHER'`,
      );
      await ds.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tcs_teacher_section_homeroom" ON "teacher_class_sections" ("teacher_id", "section_id") WHERE "assignment_type" IN ('CLASS_TEACHER','ASSISTANT_CLASS_TEACHER')`,
      );
    }
  }

  return testModule;
}
