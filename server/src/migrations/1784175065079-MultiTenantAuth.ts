import { MigrationInterface, QueryRunner } from "typeorm";

export class MultiTenantAuth1784175065079 implements MigrationInterface {
    name = 'MultiTenantAuth1784175065079'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Create schools table
        await queryRunner.query(`CREATE TABLE "schools" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(200) NOT NULL, "slug" character varying(100) NOT NULL, "domain" character varying(255), "address" text, "phone" character varying(20), "email" character varying(100), "settings" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_95b4c3f8e5b8e5b8e5b8e5b8e5b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_schools_slug" ON "schools" ("slug") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_schools_domain" ON "schools" ("domain") WHERE domain IS NOT NULL`);

        // 2. Create user_tenants table
        await queryRunner.query(`CREATE TYPE "public"."user_tenants_role_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'EXECUTIVE')`);
        await queryRunner.query(`CREATE TABLE "user_tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "role" "public"."user_tenants_role_enum" NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_tenants" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_tenants_user_tenant_role" ON "user_tenants" ("user_id", "tenant_id", "role") `);
        await queryRunner.query(`CREATE INDEX "IDX_user_tenants_user_id" ON "user_tenants" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_user_tenants_tenant_id" ON "user_tenants" ("tenant_id") `);

        // 3. Add foreign keys
        await queryRunner.query(`ALTER TABLE "user_tenants" ADD CONSTRAINT "FK_user_tenants_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_tenants" ADD CONSTRAINT "FK_user_tenants_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 4. Migrate existing users: create a default school and migrate all existing users
        const defaultSchoolId = await queryRunner.query(`INSERT INTO "schools" ("name", "slug") VALUES ('Default School', 'default-school') RETURNING "id"`);
        const schoolId = defaultSchoolId[0].id;

        // Move each user's role to user_tenants
        await queryRunner.query(`
            INSERT INTO "user_tenants" ("user_id", "tenant_id", "role")
            SELECT "id", $1, "role"::text::"public"."user_tenants_role_enum" FROM "users"
        `, [schoolId]);

        // 5. Remove role column from users
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 1. Restore role column
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'EXECUTIVE')`);
        await queryRunner.query(`ALTER TABLE "users" ADD "role" "public"."users_role_enum"`);

        // 2. Restore role from user_tenants (take the first role per user)
        await queryRunner.query(`
            UPDATE "users" SET "role" = ut."role"::text::"public"."users_role_enum"
            FROM (
                SELECT DISTINCT ON ("user_id") "user_id", "role"
                FROM "user_tenants"
                ORDER BY "user_id", "created_at" ASC
            ) ut
            WHERE "users"."id" = ut."user_id"
        `);

        // 3. Drop user_tenants
        await queryRunner.query(`ALTER TABLE "user_tenants" DROP CONSTRAINT "FK_user_tenants_user"`);
        await queryRunner.query(`ALTER TABLE "user_tenants" DROP CONSTRAINT "FK_user_tenants_tenant"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_user_tenants_tenant_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_user_tenants_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_user_tenants_user_tenant_role"`);
        await queryRunner.query(`DROP TABLE "user_tenants"`);
        await queryRunner.query(`DROP TYPE "public"."user_tenants_role_enum"`);

        // 4. Drop schools
        await queryRunner.query(`DROP INDEX "public"."IDX_schools_domain"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_schools_slug"`);
        await queryRunner.query(`DROP TABLE "schools"`);
    }
}