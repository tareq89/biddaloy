/**
 * The one place global test lifecycle hooks get registered — not as an
 * import side effect of `render-with-providers.tsx`/`factories/faker.ts`
 * themselves (see the former's own comment on `cleanupTestState`). Wired
 * into `vitest.config.ts`'s `setupFiles` for every project.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';

import './a11y/matchers';
import './jsdom-polyfills';

import { resetOnlineStatus } from './connectivity';
import { resetFactorySeed } from './factories/faker';
import { server } from './msw/server';
import { cleanupTestState } from './render-with-providers';

afterEach(cleanupTestState);
afterEach(resetFactorySeed);
afterEach(resetOnlineStatus);

// onUnhandledRequest: 'error' is the important setting here — silent
// pass-through would let a test hit a real, un-mocked network call and
// still appear to pass, hanging until timeout instead of failing loudly
// at the point the gap actually is.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
