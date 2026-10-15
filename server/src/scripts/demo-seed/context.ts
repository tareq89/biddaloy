import { faker } from '@faker-js/faker';
import type { INestApplicationContext } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { hashPassword } from '../../modules/auth/password-hash';

/** Local-only fallback. Production and DEMO_MODE runs must set DEMO_PASSWORD (assertDemoTarget refuses otherwise). */
export const demoPassword = (env: NodeJS.ProcessEnv): string => env.DEMO_PASSWORD || 'Demo@12345';

export interface DemoSlice {
  name: string;
  /** Entities this slice fills. 58.1.05's coverage guard checks the union against the schema. */
  covers: Function[];
  /** Ticket that still owes this slice's `run`; the owning ticket deletes this line. */
  owedBy?: string;
  /** Returns rows written, if the slice wants it shown in the timing table. */
  run: (ctx: DemoSeedContext) => Promise<number | void>;
}

export interface DemoSeedContext {
  ds: DataSource;
  /** Use `app.get(Service)` for real services (e.g. "today" must come from the real clock service). */
  app: INestApplicationContext;
  scale: number;
  years: number;
  /** YYYY-MM-DD, the demo's "today". */
  anchor: string;
  /** Seeded faker: same anchor, same data. Never call Math.random / Date.now in a slice. */
  rng: typeof faker;
  /** One bcrypt hash for every seeded login (cost 12 is ~250 ms; never hash per user). */
  demoPasswordHash: string;
  /** Slices publish what later slices need here (tenant ids, year ids, user ids by card key). */
  ids: Map<string, unknown>;
  timings: { slice: string; rows: number; ms: number }[];
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(pairs: readonly (readonly [T, number])[]) => T;
  /** `Math.round(n * scale)` */
  count: (n: number) => number;
}

export async function createContext(opts: {
  ds: DataSource;
  app: INestApplicationContext;
  scale: number;
  years: number;
  anchor: string;
  password: string;
}): Promise<DemoSeedContext> {
  faker.seed(Number(opts.anchor.replace(/-/g, '')) ^ 58);
  const { password, ...rest } = opts;
  return {
    ...rest,
    rng: faker,
    demoPasswordHash: await hashPassword(password),
    ids: new Map(),
    timings: [],
    pick: (items) => faker.helpers.arrayElement(items),
    weighted: (pairs) =>
      faker.helpers.weightedArrayElement(pairs.map(([value, weight]) => ({ value, weight }))),
    count: (n) => Math.round(n * opts.scale),
  };
}
