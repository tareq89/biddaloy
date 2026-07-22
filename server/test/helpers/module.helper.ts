import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

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
        synchronize: options?.synchronize ?? false,
        dropSchema: options?.dropSchema ?? false,
        logging: false,
      }),
      TypeOrmModule.forFeature(entities),
      ...imports,
    ],
    providers,
  }).compile();

  return testModule;
}