/**
 * Test Environment Setup
 *
 * Loaded by vitest's setupFiles mechanism.
 * Uses static imports that vitest's transform pipeline can handle.
 */

import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// ─── Seed UUID Constants ──────────────────────────────────────────

const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SEED_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000010';
const SEED_ACADEMIC_YEAR_ID = '00000000-0000-0000-0000-000000000020';
const SEED_CLASS_1_ID = '00000000-0000-0000-0000-000000000030';
const SEED_CLASS_2_ID = '00000000-0000-0000-0000-000000000031';
const SEED_SECTION_1_ID = '00000000-0000-0000-0000-000000000040';
const SEED_SECTION_2_ID = '00000000-0000-0000-0000-000000000041';
const SEED_ADMIN_EMAIL = 'admin@testschool.com';
const SEED_ADMIN_PASSWORD_HASH = '$2b$10$brf3rDc3UPswxvVXEs.Q9OrgBMfXkdHbCwGrpBEnXksM64gFBhD12';

/** @type {import('typeorm').DataSource|null} */
let dataSource = null;

/**
 * Initialize the test database connection, run migrations, and seed data.
 */
async function setupTestDatabase(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DB_SYNCHRONIZE = 'false';

  // Load .env.test if DATABASE_URL not set
  if (!process.env.DATABASE_URL) {
    try {
      config({ path: join(__dirname, '..', '.env.test') });
    } catch (e) {
      console.warn('No .env.test found, relying on DATABASE_URL from environment');
    }
  }

  const testDbUrl = process.env.DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a .env.test file with test database credentials.\n' +
      'Example: DATABASE_URL=postgres://postgres:***@localhost:5432/betonboi'
    );
  }

  dataSource = new DataSource({
    type: 'postgres',
    url: testDbUrl,
    entities: [join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();

  // Run migrations
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } catch (e) {
    console.warn('Migrations failed, falling back to synchronize:', e.message);
    await dataSource.synchronize();
  }
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
    const tables = [
      'students', 'guardians', 'student_guardians', 'fee_structures',
      'fee_structure_students', 'student_fees', 'payments', 'payment_allocations',
      'invoices', 'communication_logs', 'reminder_batches', 'audit_logs',
      'enrollments', 'teacher_class_sections', 'teachers', 'user_tenants',
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