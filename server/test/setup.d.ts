/**
 * Test Environment Setup
 *
 * This file is loaded before all tests via vitest.config.ts setupFiles.
 * It:
 * 1. Loads test environment variables from .env.test
 * 2. Initializes the test database connection
 * 3. Runs migrations on the test database
 * 4. Seeds the test database with baseline data
 * 5. Tears down after all tests complete
 */
declare let dataSource: any;
/**
 * Truncate transactional tables before each test.
 * Preserves seed data (schools, users, academic_years, classes, sections).
 */
export declare function clearTransactionalTables(): Promise<void>;
export { dataSource };
//# sourceMappingURL=setup.d.ts.map