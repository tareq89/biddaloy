/**
 * Test Environment Setup — CommonJS Edition
 *
 * Loads .env.test and seeds baseline data into the database.
 * Schema is created by each test file's `createTestModule()` with `synchronize: true`.
 */

const { Client } = require('pg');
const { join } = require('path');
const dotenv = require('dotenv');

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

/** @type {import('pg').Client|null} */
let client = null;

/**
 * Seed the test database with baseline data.
 */
async function seedBaselineData() {
  // Check if seed data already exists
  const existing = await client.query(
    `SELECT id FROM schools WHERE id = $1`, [SEED_TENANT_ID]
  );
  console.log('[setup.js] seedBaselineData: school exists?', existing.rows.length > 0);
  if (existing.rows.length > 0) {
    // School exists — clean up test data tables and reseed admin role + baseline data
    // Order: FK-dependent tables first
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM fee_structures');
    await client.query('DELETE FROM students');
    await client.query('DELETE FROM guardians');
    await client.query('DELETE FROM class_sections');
    await client.query('DELETE FROM classes');
    await client.query('DELETE FROM academic_years');
    await client.query('DELETE FROM user_tenants WHERE user_id = $1', [SEED_ADMIN_USER_ID]);
    // Ensure the admin user exists (may have been dropped by dropSchema: true)
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH, 'Test Admin']
    );
    await client.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID, 'ADMIN']
    );
    // Ensure seed academic year, classes, and sections exist
    const ayCheck = await client.query(
      `SELECT id FROM academic_years WHERE id = $1`, [SEED_ACADEMIC_YEAR_ID]
    );
    if (ayCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ACADEMIC_YEAR_ID, '2026-2027', '2026-01-01', '2026-12-31', true, SEED_TENANT_ID]
      );
    }
    const classCheck = await client.query(
      `SELECT id FROM classes WHERE id = $1`, [SEED_CLASS_1_ID]
    );
    if (classCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_CLASS_1_ID, 'Class 1', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
      );
      await client.query(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_CLASS_2_ID, 'Class 2', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
      );
      await client.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_SECTION_1_ID, 'Section A', SEED_CLASS_1_ID, SEED_TENANT_ID]
      );
      await client.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_SECTION_2_ID, 'Section B', SEED_CLASS_2_ID, SEED_TENANT_ID]
      );
    }
    return;
  }

  await client.query(
    `INSERT INTO schools (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_TENANT_ID, 'Test School', 'test-school']
  );

  await client.query(
    `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH, 'Test Admin']
  );

  await client.query(
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_ADMIN_USER_ID, SEED_TENANT_ID, 'ADMIN']
  );

  await client.query(
    `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_ACADEMIC_YEAR_ID, '2026-2027', '2026-01-01', '2026-12-31', true, SEED_TENANT_ID]
  );

  await client.query(
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_CLASS_1_ID, 'Class 1', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
  );
  await client.query(
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_CLASS_2_ID, 'Class 2', SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID]
  );

  await client.query(
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_SECTION_1_ID, 'Section A', SEED_CLASS_1_ID, SEED_TENANT_ID]
  );
  await client.query(
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_SECTION_2_ID, 'Section B', SEED_CLASS_2_ID, SEED_TENANT_ID]
  );
}

/**
 * Seed the test database with admin user data (for auth tests).
 */
async function seedAdminUser() {
  const existing = await client.query(
    `SELECT id FROM users WHERE id = $1`, [SEED_ADMIN_USER_ID]
  );
  if (existing.rows.length > 0) return;

  await client.query(
    `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH, 'Test Admin']
  );
}

// ─── Global Hooks ──────────────────────────────────────────────────

beforeAll(async () => {
  console.log('[setup.js] beforeAll called');
  // Load .env.test if DATABASE_URL not set
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: join(__dirname, '..', '.env.test') });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  client = new Client({ connectionString: dbUrl });
  await client.connect();

  // Seed baseline data for all integration tests
  await seedBaselineData();
}, 60000);

afterAll(async () => {
  if (client) {
    await client.end();
  }
}, 30000);

module.exports = {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
  client,
  seedBaselineData,
  seedAdminUser,
};