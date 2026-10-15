import { writeFileSync } from 'node:fs';
import Redis from 'ioredis';
import { ROLE_DEFAULT_LAYOUTS, UserRole } from '@biddaloy/shared';
import { localToday } from '../../common/time';
import { LOAD_LOGINS } from './seed-load-10k';
import {
  formatMarkdownTable,
  formatTable,
  passes,
  summarise,
  type Row,
  type Sample,
} from './load-stats';

// [8.10.7.6.02] Manual only (D24). Zero new dependencies: Node's fetch + ioredis.
// Reads like the table in README: cold phase (cache cleared before each request) and load phase.

const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.LOAD_PASSWORD ?? '';
const USERS = Number(process.env.LOAD_USERS ?? 50);
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? 60);
const COLD_REPEATS = Number(process.env.LOAD_COLD_REPEATS ?? 30);
const PHASES = (process.env.LOAD_PHASES ?? 'cold,load').split(',');
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** Share of the 50 users per role (D21 mix). Scaled to LOAD_USERS, at least 1 per role. */
const MIX: Record<string, number> = {
  TEACHER: 20,
  ADMIN: 8,
  EXECUTIVE: 6,
  ACCOUNTANT: 6,
  OFFICE_STAFF: 4,
  EXAM_CONTROLLER: 2,
  COMMITTEE: 2,
  PARENT: 2,
};

interface Session {
  role: string;
  token: string;
  tenantId: string;
  endpoints: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(s: Session, path: string): Promise<{ ms: number; status: number }> {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${s.token}`, 'X-Tenant-ID': s.tenantId },
    });
    await res.arrayBuffer(); // include the body transfer in the timing
    status = res.status;
  } catch {
    status = 0; // connection error counts as an error
  }
  return { ms: performance.now() - t0, status };
}

async function login(role: string): Promise<Session> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOAD_LOGINS[role], password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${LOAD_LOGINS[role]}: ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    memberships: { tenantId: string; role: string }[];
  };
  const m = body.memberships.find((x) => x.role === role);
  if (!m) throw new Error(`No ${role} membership for ${LOAD_LOGINS[role]}`);
  return { role, token: body.access_token, tenantId: m.tenantId, endpoints: [] };
}

async function endpointsFor(s: Session): Promise<string[]> {
  const widgets = (ROLE_DEFAULT_LAYOUTS as Record<string, string[]>)[s.role].map(
    (k) => `/dashboard/widgets/${k}`,
  );
  if (s.role !== UserRole.PARENT) return widgets;
  // The parent has no widgets; it uses three family routes for its first linked child.
  const res = await fetch(`${BASE}/api/v1/students/mine`, {
    headers: { Authorization: `Bearer ${s.token}`, 'X-Tenant-ID': s.tenantId },
  });
  const kids = (await res.json()) as { id: string }[];
  const id = kids[0]?.id;
  if (!id) throw new Error('The load parent has no linked student - was the load seed run?');
  const month = localToday().slice(0, 7);
  return [
    `/students/${id}/homework`,
    `/attendance/students/${id}/days?month=${month}`,
    `/students/${id}/results`,
  ];
}

async function clearDashCache(redis: Redis, tenantId: string): Promise<void> {
  // SCAN + DEL of this tenant's dashboard keys only. Never FLUSHALL: Redis may be shared.
  const stream = redis.scanStream({ match: `tenant:${tenantId}:dash:*`, count: 200 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length) await redis.del(...keys);
  }
}

function pickRole(i: number, counts: [string, number][]): string {
  let left = i;
  for (const [role, n] of counts) {
    if (left < n) return role;
    left -= n;
  }
  return counts[0][0];
}

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error('LOAD_PASSWORD is required.');
  const host = new URL(BASE).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`Refusing to load-test ${host}: LOAD_BASE_URL must be on this machine.`);
  }

  const sessions = new Map<string, Session>();
  for (const role of Object.keys(MIX)) sessions.set(role, await login(role));

  // Probe once: a 404 means the widget has no route yet (skipped, not a failure).
  const skipped: string[] = [];
  for (const s of sessions.values()) {
    for (const path of await endpointsFor(s)) {
      const { status } = await call(s, path);
      if (status === 404) skipped.push(`${s.role} ${path}`);
      else s.endpoints.push(path);
    }
  }

  const rows: Row[] = [];
  const add = (phase: string, role: string, endpoint: string, samples: Sample[]) =>
    rows.push({ phase, role, endpoint, ...summarise(samples) });
  const ok = (status: number) => status >= 200 && status < 300;

  if (PHASES.includes('cold')) {
    const redis = new Redis(REDIS_URL);
    try {
      for (const s of sessions.values()) {
        for (const path of s.endpoints) {
          const samples: Sample[] = [];
          for (let i = 0; i < COLD_REPEATS; i++) {
            await clearDashCache(redis, s.tenantId);
            const r = await call(s, path);
            samples.push({ ms: r.ms, ok: ok(r.status) });
          }
          add('cold', s.role, path, samples);
        }
      }
    } finally {
      redis.disconnect();
    }
  }

  if (PHASES.includes('load')) {
    const counts = Object.entries(MIX).map(
      ([role, n]) => [role, Math.max(1, Math.round((n * USERS) / 50))] as [string, number],
    );
    const total = counts.reduce((a, [, n]) => a + n, 0);
    const bucket = new Map<string, Sample[]>(); // "role|path" -> samples
    const deadline = Date.now() + DURATION_S * 1000;
    await Promise.all(
      Array.from({ length: total }, async (_, i) => {
        const s = sessions.get(pickRole(i, counts))!;
        while (Date.now() < deadline) {
          for (const path of s.endpoints) {
            if (Date.now() >= deadline) break;
            const r = await call(s, path);
            const key = `${s.role}|${path}`;
            if (!bucket.has(key)) bucket.set(key, []);
            bucket.get(key)!.push({ ms: r.ms, ok: ok(r.status) });
            await sleep(Math.random() * 200); // think time
          }
        }
      }),
    );
    for (const [key, samples] of bucket) {
      const [role, path] = key.split('|');
      add('load', role, path, samples);
    }
  }

  console.log(formatTable(rows));
  if (skipped.length) console.log(`\nSkipped (404, no route yet): ${skipped.join(', ')}`);
  const failed = rows.filter((r) => !passes(r)).length;
  console.log(`\n${failed} of ${rows.length} checks FAILED (p95 >= 300 ms or errors).`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`load-results-${stamp}.json`, JSON.stringify({ rows, skipped }, null, 2));
  writeFileSync(
    `load-results-${stamp}.md`,
    [
      `# Dashboard load run ${stamp}`,
      '',
      `users=${USERS} duration=${DURATION_S}s cold repeats=${COLD_REPEATS} base=${BASE}`,
      '',
      formatMarkdownTable(rows),
      '',
      skipped.length ? `Skipped (404): ${skipped.join(', ')}` : 'Skipped: none',
      '',
      `${failed} of ${rows.length} checks FAILED.`,
    ].join('\n'),
  );
  console.log(`Wrote load-results-${stamp}.json and .md`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
