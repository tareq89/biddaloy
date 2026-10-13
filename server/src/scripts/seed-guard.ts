const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Throws unless the target DB is on this machine and NODE_ENV is not production. */
export function assertLocalSeedTarget(
  env: NodeJS.ProcessEnv,
  script: 'seed' | 'db:reset' | 'db:clear',
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to run ${script} with NODE_ENV=production — it writes or destroys data ` +
        'that must never touch a real database. Set NODE_ENV=development or unset it.',
    );
  }
  let host: string;
  try {
    host = new URL(env.DATABASE_URL ?? '').hostname;
  } catch {
    throw new Error(`Refusing to run ${script}: DATABASE_URL is missing or not a valid URL.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run ${script} against database host "${host}". ` +
        'Point DATABASE_URL at localhost (an SSH tunnel works) to seed a remote database on purpose.',
    );
  }
}
