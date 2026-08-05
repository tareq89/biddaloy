/**
 * The one place global test lifecycle hooks get registered — not as an
 * import side effect of `render-with-providers.tsx`/`factories/faker.ts`
 * themselves (see the former's own comment on `cleanupTestState`). Wired
 * into `vitest.config.ts`'s `setupFiles` for every project.
 */
import { afterEach } from 'vitest';

import { resetFactorySeed } from './factories/faker';
import { cleanupTestState } from './render-with-providers';

afterEach(cleanupTestState);
afterEach(resetFactorySeed);
