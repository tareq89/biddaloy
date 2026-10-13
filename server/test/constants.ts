/**
 * Seed UUID constants for test data.
 * These are valid UUIDv4-formatted strings used consistently
 * across setup.ts, test helpers, and all test files.
 */
export const SEED_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000010';
export const SEED_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000020';
export const SEED_CLASS_1_ID = '00000000-0000-4000-8000-000000000030';
export const SEED_CLASS_2_ID = '00000000-0000-4000-8000-000000000031';
export const SEED_SECTION_1_ID = '00000000-0000-4000-8000-000000000040';
export const SEED_SECTION_2_ID = '00000000-0000-4000-8000-000000000041';

/**
 * Seed data values
 */
export const SEED_ADMIN_EMAIL = 'admin@testschool.com';
export const SEED_ADMIN_PASSWORD = 'password123';
// bcrypt hash for 'password123' at BCRYPT_COST (12). A cheaper hash would make
// every fixture login pay the cost-12 padding plus a rehash write (75.11),
// ~8x slower, enough to time out specs that log in many roles per test.
export const SEED_ADMIN_PASSWORD_HASH =
  '$2b$12$seyMXDrcXS4B2fjR5Zr2me6vXXz/fMUCZYknBOSuHtF3j5Au3EJp2';
