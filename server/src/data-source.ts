import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { buildDatabaseSsl } from './db-ssl';
import { RedactingTypeOrmLogger } from './db-logger';

// Load .env from the project root (works for both dev and build-output)
const envPath = resolve(__dirname, '..', '..', '.env');
config({ path: envPath });

const { ssl, warning } = buildDatabaseSsl(
  process.env.NODE_ENV,
  process.env.DB_SSL,
  process.env.DB_SSL_REJECT_UNAUTHORIZED,
);
if (warning) {
  console.warn(warning);
}

const options: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl,
  logger: new RedactingTypeOrmLogger(process.env.NODE_ENV !== 'production'),
  entities: [resolve(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [resolve(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
};

const dataSource = new DataSource(options);
export default dataSource;