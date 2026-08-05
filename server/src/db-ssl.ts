export interface DatabaseSslResult {
  ssl: false | { rejectUnauthorized: boolean };
  warning?: string;
}

/**
 * The compose stack's Postgres sits on a private Docker network today, but
 * `DATABASE_URL` carries the DB password (and every query carries PII) in
 * cleartext over whatever transport TypeORM is given — a bare TCP socket
 * unless told otherwise. Any move to a managed/remote Postgres sends both
 * over an untrusted network by default (#36).
 *
 * Required in production, refusing to boot otherwise — the same "loud
 * failure beats a silent gap" posture as ENABLE_API_DOCS's Basic Auth
 * requirement in main.ts. Outside production this stays opt-in: local dev
 * against a plain docker-compose Postgres has no TLS to speak of.
 */
export function buildDatabaseSsl(
  nodeEnv: string | undefined,
  dbSslEnv: string | undefined,
  rejectUnauthorizedEnv: string | undefined,
): DatabaseSslResult {
  const enabled = dbSslEnv === 'true';
  const isProduction = nodeEnv === 'production';

  if (isProduction && !enabled) {
    throw new Error(
      'DB_SSL must be "true" in production — refusing to connect to Postgres over an unencrypted connection. ' +
        'Set DB_SSL=true (and use an sslmode=require-style DATABASE_URL) once the target Postgres serves TLS.',
    );
  }

  if (!enabled) {
    return { ssl: false };
  }

  // A common copy-paste for a managed DB's self-signed cert — silently
  // disables certificate verification if left unquestioned. Still allowed
  // (some managed providers genuinely require it), but never silently.
  const rejectUnauthorized = rejectUnauthorizedEnv !== 'false';
  const warning = rejectUnauthorized
    ? undefined
    : 'DB_SSL_REJECT_UNAUTHORIZED=false disables Postgres certificate verification — only intended for a managed database with a self-signed cert you trust out-of-band, never as a general workaround.';

  return { ssl: { rejectUnauthorized }, warning };
}
