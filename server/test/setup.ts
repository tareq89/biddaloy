/**
 * Test Environment Setup
 *
 * Loaded by vitest's setupFiles mechanism.
 *
 * TypeORM's `entities`/`migrations` glob options are loaded via its own
 * internal `require()`, not through vitest's module graph — so without a
 * transpile hook, requiring the raw `*.entity.ts`/migration `.ts` files
 * fails with `SyntaxError: Invalid or unexpected token` (Node can't parse
 * TypeScript directly). Registering ts-node here fixes that.
 */
import 'ts-node/register/transpile-only';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from './constants';

// Must run at module top level, not deferred inside a beforeAll-only function:
// e2e specs import AppModule (which reads process.env via ConfigModule) at file
// top level too, and that import is evaluated during test *collection*, before
// any beforeAll runs. Loading .env.test here guarantees it's populated first.
process.env.NODE_ENV = 'test';
process.env.DB_SYNCHRONIZE = 'false';
// override: true — .env.test must win even if the shell already exports
// DATABASE_URL (e.g. pointing at the real dev DB per .env.example). Without
// this, dotenv's default "never overwrite an existing var" behavior means a
// dev-shaped DATABASE_URL in the ambient shell silently wins, and every test
// run fails assertTestDatabaseUrl() below with a confusing refusal.
config({ path: join(__dirname, '..', '.env.test'), override: true });

/** @type {import('typeorm').DataSource|null} */
let dataSource = null;

/**
 * Refuses to run destructive setup/teardown against a database that doesn't
 * look like a dedicated test database, so a misconfigured DATABASE_URL can
 * never wipe real dev/prod data.
 */
function assertTestDatabaseUrl(url: string): void {
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests against database "${dbName}" — its name doesn't ` +
      'contain "test". Point DATABASE_URL in server/.env.test at a dedicated ' +
      'test database (e.g. betonboi_test) to avoid wiping real data.'
    );
  }
}

/**
 * Initialize the test database connection, run migrations, and seed data.
 */
async function setupTestDatabase(): Promise<void> {
  const testDbUrl = process.env.DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a .env.test file with test database credentials.\n' +
      'Example: DATABASE_URL=postgres://postgres:***@localhost:5432/betonboi_test'
    );
  }
  assertTestDatabaseUrl(testDbUrl);

  dataSource = new DataSource({
    type: 'postgres',
    url: testDbUrl,
    entities: [join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
    // Must match src/data-source.ts's migrationsTableName — otherwise this
    // DataSource can't see which migrations already ran and re-applies them.
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
}

/**
 * Seed the test database with baseline data.
 */
async function seedBaselineData(): Promise<void> {
  if (!dataSource) return;

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    const existing = await queryRunner.query(
      `SELECT id FROM schools WHERE id = $1`,
      [SEED_TENANT_ID]
    );
    if (existing.length > 0) {
      return;
    }

    await queryRunner.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [SEED_TENANT_ID, 'Test School', 'test-school']
    );

    await queryRunner.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH, 'Test Admin']
    );

    await queryRunner.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID, 'ADMIN']
    );

    await queryRunner.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [SEED_ACADEMIC_YEAR_ID, '2026-2027', '2026-01-01', '2026-12-31', true, SEED_TENANT_ID]
    );

    await queryRunner.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [SEED_CLASS_1_ID, 'Class 1', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
    );
    await queryRunner.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [SEED_CLASS_2_ID, 'Class 2', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
    );

    await queryRunner.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [SEED_SECTION_1_ID, 'Section A', SEED_CLASS_1_ID, SEED_TENANT_ID]
    );
    await queryRunner.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [SEED_SECTION_2_ID, 'Section B', SEED_CLASS_2_ID, SEED_TENANT_ID]
    );
  } finally {
    await queryRunner.release();
  }
}

/**
 * Truncate transactional tables before each test.
 */
async function clearTransactionalTables(): Promise<void> {
  if (!dataSource) return;

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    // Note: user_tenants is intentionally excluded — it holds the seeded
    // admin's tenant membership (like schools/users/academic_years/classes,
    // which are also excluded), and truncating it here would strip the
    // seeded admin's authorization on the very first beforeEach.
    const tables = [
      'students', 'guardians', 'student_guardians', 'fee_structures',
      'fee_structure_students', 'student_fees', 'payments', 'payment_allocations',
      'invoices', 'communication_logs', 'reminder_batches', 'audit_logs',
      'enrollments', 'teacher_class_sections', 'teachers',
    ];

    for (const table of tables) {
      await queryRunner.query(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  } finally {
    await queryRunner.release();
  }
}

// ─── Global Hooks ──────────────────────────────────────────────────

beforeAll(async () => {
  await setupTestDatabase();
  await seedBaselineData();
}, 60000);

afterAll(async () => {
  if (dataSource && dataSource.isInitialized) {
    try {
      await dataSource.dropDatabase();
    } catch (e) {
      console.warn('[Teardown] Drop failed:', e.message);
    }
    await dataSource.destroy();
  }
}, 30000);

beforeEach(async () => {
  await clearTransactionalTables();
}, 30000);

export { dataSource, clearTransactionalTables };