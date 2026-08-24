import * as path from 'node:path';

import type { SeedRole } from '../seed-contract';

// Where the setup project ([8.5.2], auth.setup.ts) writes storageState
// files, and how specs find them. Lives outside auth.setup.ts because
// Playwright forbids test files importing other test files.
export const AUTH_DIR = path.join(__dirname, '..', '.auth');

export const storageStatePath = (role: SeedRole): string => path.join(AUTH_DIR, `${role}.json`);

/** Same session cookie, no persisted tenant — for tenant-picker specs. */
export const noTenantStatePath = (role: SeedRole): string =>
  path.join(AUTH_DIR, `${role}.no-tenant.json`);
