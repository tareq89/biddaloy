import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from './all-entities';
import { SEED_TENANT_ID } from './constants';
import { STAGING_SCRUB_COLUMNS } from './staging-scrub-columns';
import { TenantSettingsDto } from '../src/modules/schools/dto/tenant-settings.dto';
import { getSecretPaths } from '../src/modules/schools/settings/secret-paths.util';

/**
 * [Epic 79 / #2793] Staging scrub.
 *
 * (a) Guard: reads the live schema and fails when a column that may hold personal data is not in
 *     the reviewed list (`staging-scrub-columns.ts`), so a new column cannot leak to staging.
 * (b) Runs `scripts/backup/scrub.sql` for real, inside a transaction that is rolled back, and
 *     checks that no original detail survives.
 */

// Column names that may hold personal data, in a text-like column.
const PERSONAL_NAME =
  /(phone|email|name|address|token|secret|password|birth|health|note|contact|otp|totp|mobile|dob|nid|passport|endpoint|p256dh|auth|ip_|user_agent|photo|picture|signature|remark|comment|religion|blood|disab|occupation|father|mother|guardian|relation|bank|salary|hash|street|city|district|village|post_?code|url|handle|social|whatsapp|username|reason|description|message|body|filename)/i;
// Any of these columns is reviewed whatever its name: free structure can hold anything.
const STRUCTURED_TYPES = ['jsonb', 'json', 'ARRAY', 'bytea'];
const TEXT_TYPES = ['character varying', 'character', 'text'];

const SCRUB_SQL = join(__dirname, '..', '..', 'scripts', 'backup', 'scrub.sql');
const HASH = '$2b$12$' + 'x'.repeat(53);

let ds: DataSource;

beforeAll(async () => {
  ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, entities: ALL_ENTITIES });
  await ds.initialize();
});
afterAll(async () => {
  await ds?.destroy();
});

describe('staging scrub column guard', () => {
  it('lists every column that may hold personal data', async () => {
    const rows: { table_name: string; column_name: string; data_type: string }[] = await ds.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name NOT LIKE 'typeorm\\_%'`,
    );
    const reviewed = new Set(STAGING_SCRUB_COLUMNS.map((c) => `${c.table}.${c.column}`));
    const emptied = new Set(
      STAGING_SCRUB_COLUMNS.filter((c) => c.handling === 'delete-row' && c.column === '*').map(
        (c) => c.table,
      ),
    );
    const missing = rows
      .filter(
        (r) =>
          (TEXT_TYPES.includes(r.data_type) && PERSONAL_NAME.test(r.column_name)) ||
          STRUCTURED_TYPES.includes(r.data_type),
      )
      .filter(
        (r) => !emptied.has(r.table_name) && !reviewed.has(`${r.table_name}.${r.column_name}`),
      )
      .map(
        (r) =>
          `new column ${r.table_name}.${r.column_name} may hold personal data — add it to scrub.sql and staging-scrub-columns.ts`,
      );
    expect(missing).toEqual([]);
  });

  it('lists only columns that exist', async () => {
    const rows: { table_name: string; column_name: string }[] = await ds.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const tables = new Set(rows.map((r) => r.table_name));
    const stale = STAGING_SCRUB_COLUMNS.filter((c) =>
      c.column === '*' ? !tables.has(c.table) : !live.has(`${c.table}.${c.column}`),
    ).map((c) => `${c.table}.${c.column}`);
    expect(stale).toEqual([]);
  });

  it('only a list entry with column * may empty a table', () => {
    const bad = STAGING_SCRUB_COLUMNS.filter(
      (c) => (c.handling === 'delete-row') !== (c.column === '*'),
    );
    expect(bad).toEqual([]);
  });
});

describe('scrub.sql', () => {
  const sfx = randomUUID().slice(0, 8);
  const REAL_EMAIL = `real-${sfx}@school.example`;
  const REAL_PHONE = `+88017${sfx.replace(/\D/g, '1').padEnd(8, '1').slice(0, 8)}`;
  const REAL_NAME = `Realname${sfx}`;
  const SMOKE_SLUG = `smoke-${sfx}`;
  const platformId = randomUUID();
  const smokeId = randomUUID();
  const adminUserId = randomUUID();
  const smokeUserId = randomUUID();
  const parentUserId = randomUUID();
  const SECRET_PATHS = getSecretPaths(TenantSettingsDto as never);
  let qr: QueryRunner;

  const q = (sql: string, params?: unknown[]) => qr.query(sql, params);
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0];

  async function insertSchool(id: string, slug: string, settings: object) {
    await q(
      `INSERT INTO schools (id, name, slug, phone, email, address, settings)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::text, $7::jsonb)`,
      [id, `School ${slug}`, slug, REAL_PHONE, REAL_EMAIL, REAL_NAME, JSON.stringify(settings)],
    );
  }
  async function insertUser(id: string, email: string) {
    await q(
      `INSERT INTO users (id, email, phone, full_name, password_hash)
       VALUES ($1, $2, $3, $4, 'old-hash')`,
      [id, email, `+88018${id.replace(/\D/g, '').padEnd(8, '2').slice(0, 8)}`, REAL_NAME],
    );
  }

  /** The secrets in the shape TenantSettingsDto describes, one value per @Secret() path. */
  function settingsWithAllSecrets() {
    const settings: Record<string, unknown> = {};
    for (const path of SECRET_PATHS) {
      const keys = path.split('.');
      let node = settings;
      for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
      node[keys[keys.length - 1]] = `secret-${sfx}`;
    }
    return settings;
  }

  async function prepare() {
    qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction(); // never committed: the test database is left as it was
    await insertSchool(platformId, `platform-${sfx}`, {});
    await insertSchool(smokeId, SMOKE_SLUG, {});
    await insertSchool(randomUUID(), `real-school-${sfx}`, settingsWithAllSecrets());
    await insertUser(adminUserId, `admin-${sfx}@platform.example`);
    await insertUser(smokeUserId, `smoke-${sfx}@school.example`);
    await insertUser(parentUserId, REAL_EMAIL);
    // ids are random UUIDs made above, so they are safe to inline (a bound $2 trips a type check here)
    await q(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ('${adminUserId}', '${platformId}', 'SUPER_ADMIN')`,
    );
    await q(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ('${smokeUserId}', '${smokeId}', 'ADMIN')`,
    );
    await q(
      `INSERT INTO guardians (tenant_id, full_name, relationship, phone, email, alternate_phone, address, occupation)
       VALUES ($1, $2, 'FATHER', $3, $4, $3, $5, $6)`,
      [SEED_TENANT_ID, REAL_NAME, REAL_PHONE, REAL_EMAIL, REAL_NAME, REAL_NAME],
    );
    await q(
      `INSERT INTO communication_logs (tenant_id, medium, message_body, recipient_address, recipient_name, status)
       VALUES ($1, 'SMS', $2, $3, $4, 'QUEUED'), ($1, 'SMS', $2, $3, $4, 'SENT')`,
      [SEED_TENANT_ID, `hello ${REAL_NAME}`, REAL_PHONE, REAL_NAME],
    );
    await q(
      `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, 'k', 'a')`,
      [SEED_TENANT_ID, parentUserId, `https://push.example/${sfx}`],
    );
    const scrub = readFileSync(SCRUB_SQL, 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .replace(/:'staging_password_hash'/g, `'${HASH}'`)
      .replace(/:'smoke_slug'/g, `'${SMOKE_SLUG}'`)
      .replace(/:'platform_tenant_id'/g, `'${platformId}'`);
    await q(scrub);
  }

  const checks: [string, () => Promise<void>][] = [];
  checks.push([
    'keeps only super admin and smoke school emails',
    async () => {
      const rows = await q(`SELECT id FROM users WHERE email NOT LIKE '%@staging.invalid'`);
      expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(
        [adminUserId, smokeUserId].sort(),
      );
    },
  ]);

  checks.push([
    'leaves no original email, phone or name in users, guardians or schools',
    async () => {
      const hits = await one(
        `SELECT (SELECT count(*) FROM users WHERE id <> $4 AND (phone = $1 OR full_name = $2 OR email = $3))::int
            + (SELECT count(*) FROM guardians WHERE phone = $1 OR alternate_phone = $1 OR email = $3
                 OR full_name = $2 OR address = $2 OR occupation = $2)::int
            + (SELECT count(*) FROM schools WHERE id <> $5 AND (phone = $1 OR email = $3 OR address = $2))::int AS n`,
        [REAL_PHONE, REAL_NAME, REAL_EMAIL, smokeUserId, platformId],
      );
      expect(hits.n).toBe(0);
    },
  ]);

  checks.push([
    'gives every user the staging password hash',
    async () => {
      const bad = await one(
        `SELECT count(*)::int AS n FROM users WHERE password_hash IS DISTINCT FROM $1`,
        [HASH],
      );
      expect(bad.n).toBe(0);
    },
  ]);

  checks.push([
    'removes every @Secret() path from every school settings',
    async () => {
      expect(SECRET_PATHS.length).toBeGreaterThan(0);
      for (const path of SECRET_PATHS) {
        const row = await one(
          `SELECT count(*)::int AS n FROM schools WHERE settings #> $1::text[] IS NOT NULL`,
          [`{${path.split('.').join(',')}}`],
        );
        expect(row.n, path).toBe(0);
      }
    },
  ]);

  checks.push([
    'cancels queued messages and blanks every message',
    async () => {
      const row = await one(
        `SELECT count(*) FILTER (WHERE status = 'QUEUED')::int AS queued,
              count(*) FILTER (WHERE message_body <> '[scrubbed]' OR recipient_address <> 'scrubbed')::int AS leaked
       FROM communication_logs`,
      );
      expect(row).toEqual({ queued: 0, leaked: 0 });
    },
  ]);

  checks.push([
    'empties token, session and device tables',
    async () => {
      for (const t of [
        'refresh_tokens',
        'auth_tokens',
        'calendar_feed_tokens',
        'invoice_share_tokens',
        'push_subscriptions',
        'attendance_devices',
        'user_identities',
      ]) {
        const row = await one(`SELECT count(*)::int AS n FROM ${t}`);
        expect(row.n, t).toBe(0);
      }
    },
  ]);

  checks.push([
    'keeps the append-only triggers enabled',
    async () => {
      const rows = await q(
        `SELECT tgname FROM pg_trigger WHERE tgenabled = 'D' AND NOT tgisinternal`,
      );
      expect(rows).toEqual([]);
    },
  ]);

  // One test: the whole thing runs in a single transaction that is rolled back. A transaction
  // held open across tests would block the TRUNCATE in the shared beforeEach hook (test/setup.ts).
  it('scrubs production-shaped data (rolled back)', async () => {
    try {
      await prepare();
      for (const [name, check] of checks) {
        try {
          await check();
        } catch (err) {
          throw new Error(`${name}: ${(err as Error).message}`);
        }
      }
    } finally {
      await qr?.rollbackTransaction();
      await qr?.release();
    }
  });
});
