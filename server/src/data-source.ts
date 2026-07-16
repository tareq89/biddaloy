import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from the project root (works for both dev and build-output)
const envPath = resolve(__dirname, '..', '..', '.env');
config({ path: envPath });

const options: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [resolve(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [resolve(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
};

const dataSource = new DataSource(options);
export default dataSource;