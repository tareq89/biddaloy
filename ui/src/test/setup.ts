/**
 * The one place a global test lifecycle hook gets registered — not as an
 * import side effect of `render-with-providers.tsx` itself (see that
 * file's own comment on `cleanupTestState`). Wired into `vitest.config.ts`'s
 * `setupFiles` for every project that uses `renderWithProviders`.
 */
import { afterEach } from 'vitest';

import { cleanupTestState } from './render-with-providers';

afterEach(cleanupTestState);
