import { DataSource } from 'typeorm';
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '..', '..', '..', '.env') });

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // No entities needed — we drop via raw SQL
});

async function dbClear() {
  // Safety guard: require explicit confirmation env var
  if (process.env.DB_DESTROY_CONFIRM !== "true") {
    console.error(
      "Destructive operation guard activated.\n" +
      "Set DB_DESTROY_CONFIRM=true to confirm you want to drop ALL tables.\n" +
      "This protects against accidental database destruction in production."
    );
    process.exit(1);
  }

  // Additional guard: refuse to run in production
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to run db:clear in NODE_ENV=production.\n" +
      "Set NODE_ENV=development or unset it before running this destructive command."
    );
    process.exit(1);
  }

  let queryRunner;
  try {
    await dataSource.initialize();
    queryRunner = dataSource.createQueryRunner();

    // Wrap all cleanup in a single transaction so partial failures roll back
    await queryRunner.query('BEGIN');

    try {
      // Drop all tables in the public schema with CASCADE to handle FKs
      await queryRunner.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
          LOOP
            EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `);

      // Drop the typeorm_migrations table if it exists outside the loop
      await queryRunner.query(`
        DROP TABLE IF EXISTS public.typeorm_migrations CASCADE;
      `);

      // Drop all custom ENUM types (Postgres keeps them even after tables are dropped)
      await queryRunner.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (
            SELECT t.typname
            FROM pg_type t
            JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typtype = 'e'
          )
          LOOP
            EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
          END LOOP;
        END $$;
      `);

      await queryRunner.query('COMMIT');

      console.log('All tables and custom types dropped. Database is clean.');
      console.log('Run `yarn workspace @beton-boi/server migration:run` to re-create the schema from migrations.');
    } catch (e) {
      await queryRunner.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    if (queryRunner) {
      await queryRunner.release().catch(() => {});
    }
    await dataSource.destroy().catch(() => {});
  }
}

dbClear().catch((err) => {
  console.error('db:clear failed:', err);
  process.exit(1);
});