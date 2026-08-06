/**
 * MSW's Node runtime — every Vitest integration test intercepts real HTTP
 * calls through this, not a per-test mock of `apiClient` itself. Lifecycle
 * (`listen`/`resetHandlers`/`close`) is wired into `ui/src/test/setup.ts`,
 * not here, for the same reason `render-with-providers.tsx`'s
 * `cleanupTestState` isn't self-registering: importing `server` to add a
 * one-off handler shouldn't silently opt a file into starting/stopping a
 * mock HTTP server as an import side effect.
 */
import { setupServer } from 'msw/node';

import { handlers } from './handlers';

export const server = setupServer(...handlers);
