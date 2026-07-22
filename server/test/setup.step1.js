/**
 * Test Environment Setup
 */
const { join } = require('path');
const dotenv = require('dotenv');

console.log('  [setup] Loading...');

// Load .env.test
try {
  dotenv.config({ path: join(__dirname, '..', '.env.test') });
  console.log('  [setup] dotenv loaded');
} catch (e) {
  console.log('  [setup] dotenv error:', e.message);
}

let dataSource = null;

beforeAll(async () => {
  console.log('  [beforeAll] Loading TypeORM...');
  const { DataSource } = require('typeorm');
  
  console.log('  [beforeAll] Creating DataSource...');
  dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: false,
  });

  console.log('  [beforeAll] Initializing DataSource...');
  await dataSource.initialize();
  console.log('  [beforeAll] DataSource initialized');

  try {
    await dataSource.runMigrations({ transaction: 'each' });
    console.log('  [beforeAll] Migrations run');
  } catch (e) {
    console.log('  [beforeAll] Migrations failed, synchronizing:', e.message);
    await dataSource.synchronize();
    console.log('  [beforeAll] Sync complete');
  }
}, 60000);

afterAll(async () => {
  if (dataSource && dataSource.isInitialized) {
    console.log('  [afterAll] Dropping database...');
    try {
      await dataSource.dropDatabase();
    } catch (e) {
      console.warn('  [afterAll] Drop failed:', e.message);
    }
    await dataSource.destroy();
    console.log('  [afterAll] Done');
  }
}, 30000);

module.exports = { dataSource };
console.log('  [setup] Exports ready');