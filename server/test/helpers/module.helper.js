"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestModule = createTestModule;
const testing_1 = require("@nestjs/testing");
const typeorm_1 = require("@nestjs/typeorm");
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
async function createTestModule(entities, providers, imports = []) {
    return testing_1.Test.createTestingModule({
        imports: [
            typeorm_1.TypeOrmModule.forRoot({
                type: 'postgres',
                url: process.env.DATABASE_URL,
                entities,
                synchronize: false,
                logging: false,
            }),
            typeorm_1.TypeOrmModule.forFeature(entities),
            ...imports,
        ],
        providers,
    }).compile();
}
//# sourceMappingURL=module.helper.js.map