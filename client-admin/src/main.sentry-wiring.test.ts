import { initSentry } from '@biddaloy/ui/api';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * [8.12.7] wiring guard. Every other test in this issue proves the
 * instrumentation is *callable*; this one proves the real app entry
 * actually calls it, with the real router instance.
 *
 * That distinction is the whole failure mode: `initSentry` without a
 * router registers no tracing integration at all, so LCP/CLS/INP would
 * simply never be collected — and nothing would fail. It also pins the
 * ordering constraint (`createRouter` must run *before* `initSentry`),
 * which a future tidy-up moving the call back to the top of the module
 * would otherwise break silently.
 */
vi.mock('@biddaloy/ui/api', () => ({
  createAppQueryClient: () => new QueryClient(),
  getActiveTenant: vi.fn(() => null),
  initSentry: vi.fn(),
  registerSessionExpiredHandler: vi.fn(),
  startQueueReplay: vi.fn(),
  subscribeAuthState: vi.fn(),
  updateSentryRouteTag: vi.fn(),
  updateSentryTenantTag: vi.fn(),
}));
vi.mock('@biddaloy/ui/mocks', () => ({ enableMocking: () => Promise.resolve() }));
vi.mock('./pwa/register', () => ({
  registerServiceWorker: vi.fn(),
  reloadForUpdate: vi.fn(),
}));
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: vi.fn(), unmount: vi.fn() }),
}));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('client-admin entry point', () => {
  it('initializes Sentry with the app router, so browser tracing is actually on', async () => {
    await import('./main');

    expect(initSentry).toHaveBeenCalledTimes(1);
    const options = vi.mocked(initSentry).mock.calls[0]?.[0];
    expect(options?.environment).toBe(import.meta.env.MODE);
    // A real TanStack Router instance, not a placeholder — `subscribe`
    // is the method `main.tsx` itself relies on right after this call.
    expect(typeof (options?.router as { subscribe?: unknown } | undefined)?.subscribe).toBe(
      'function',
    );
    // With `VITE_SENTRY_TRACES_SAMPLE_RATE` unset (as it is in CI), the
    // key is absent rather than a `NaN` from `parseFloat(undefined)` —
    // otherwise the entry point would silently override the default.
    expect(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE).toBeUndefined();
    expect(options).not.toHaveProperty('tracesSampleRate');
  });
});
