import { parse } from 'pg-connection-string';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Throws unless the target DB is on this machine and NODE_ENV is not production. */
export function assertLocalSeedTarget(
  env: NodeJS.ProcessEnv,
  script: 'seed' | 'db:reset' | 'db:clear' | 'load:seed',
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to run ${script} with NODE_ENV=production — it writes or destroys data ` +
        'that must never touch a real database. Set NODE_ENV=development or unset it.',
    );
  }
  try {
    new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error(`Refusing to run ${script}: DATABASE_URL is missing or not a valid URL.`);
  }
  // The host pg will actually dial: pg-connection-string lets `?host=` override the authority,
  // and an empty host falls back to PGHOST, then localhost (pg's own defaults).
  const host = parse(env.DATABASE_URL ?? '').host || env.PGHOST || 'localhost';
  // A path is a Unix socket, which is always on this machine.
  if (!LOCAL_HOSTS.has(host) && !host.startsWith('/')) {
    throw new Error(
      `Refusing to run ${script} against database host "${host}". ` +
        'Point DATABASE_URL at localhost (an SSH tunnel works) to seed a remote database on purpose.',
    );
  }
}
