/**
 * The one place global test lifecycle hooks get registered — not as an
 * import side effect of `render-with-providers.tsx`/`factories/faker.ts`
 * themselves (see the former's own comment on `cleanupTestState`). Wired
 * into `vitest.config.ts`'s `setupFiles` for every project.
 */
// [8.12.3] Must be the first import in this file, and this file is the
// first thing every project runs. `dexie` captures `globalThis.indexedDB`
// once, at *its* import time (`Dexie.dependencies`), and this setup file
// transitively imports `api/auth-state.ts` → `api/offline-db.ts` → dexie.
// Installing the polyfill from inside an individual test file is
// therefore too late: dexie has already recorded "no IndexedDB here" and
// every query throws `MissingAPIError`. Neither jsdom nor Node provides
// IndexedDB, so without this the offline cache is untestable at all.
import 'fake-indexeddb/auto';

import { afterAll, afterEach, beforeAll } from 'vitest';

import './a11y/matchers';
import './jsdom-polyfills';

import { resetOnlineStatus } from './connectivity';
import { resetFactorySeed } from './factories/faker';
import { resetSchoolsStore } from './msw/handlers/schools';
import { server } from './msw/server';
import { cleanupTestState } from './render-with-providers';
import { resetSystemPrefersDark } from './system-theme';

afterEach(cleanupTestState);
afterEach(resetFactorySeed);
afterEach(resetOnlineStatus);
afterEach(resetSchoolsStore);
afterEach(resetSystemPrefersDark);

// onUnhandledRequest: 'error' is the important setting here — silent
// pass-through would let a test hit a real, un-mocked network call and
// still appear to pass, hanging until timeout instead of failing loudly
// at the point the gap actually is.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
