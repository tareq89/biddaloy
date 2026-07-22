import { TestingModule } from '@nestjs/testing';
/**
 * Creates a NestJS testing module connected to the test database.
 *
 * This is used by integration tests that need real TypeORM repositories.
 * It uses the same DATABASE_URL as the test setup.
 *
 * @param entities - Array of entity classes to register
 * @param providers - Array of providers (services, etc.) to register
 * @param imports - Additional imports
 * @returns A configured TestingModule
 */
export declare function createTestModule(entities: any[], providers: any[], imports?: any[]): Promise<TestingModule>;
//# sourceMappingURL=module.helper.d.ts.map