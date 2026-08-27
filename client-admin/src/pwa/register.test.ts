/**
 * [8.12.2]: the update flow's wiring — who gets prompted, who reloads, and
 * (the AC that matters most) who is left alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showUpdatedElsewherePrompt, showUpdatePrompt } from './update-prompt';

type RegisterOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
};

vi.mock('./update-prompt', () => ({
  showUpdatePrompt: vi.fn(),
  showUpdatedElsewherePrompt: vi.fn(),
}));

const updateSW = vi.fn(() => Promise.resolve());
const registerSW = vi.fn<(options: RegisterOptions) => typeof updateSW>(() => updateSW);

// Resolves to `client-admin/src/test/virtual-pwa-register-stub.ts` under
// Vitest — the real `virtual:pwa-register` only exists inside a build.
vi.mock('virtual:pwa-register', () => ({ registerSW }));

const reload = vi.fn();

/** Fresh module state per test: `register.ts` keeps the "this tab
 * accepted" flag and the `updateSW` handle at module scope. */
async function loadRegister() {
  vi.resetModules();
  return import('./register');
}

/** Runs `registerServiceWorker()` and hands back the options the module
 * passed to `registerSW`, once the dynamic import has settled. */
async function registerAndCaptureOptions(): Promise<{
  options: RegisterOptions;
  reloadForUpdate: () => void;
}> {
  const { registerServiceWorker, reloadForUpdate } = await loadRegister();
  registerServiceWorker();
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalled());
  return { options: registerSW.mock.calls[0]![0], reloadForUpdate };
}

describe('registerServiceWorker', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    // jsdom's `location.reload` is a no-op that logs "Not implemented";
    // replacing the whole object is the only way to observe the call.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('does not register at all under mocks (MSW owns the root scope)', async () => {
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    const { registerServiceWorker } = await loadRegister();

    registerServiceWorker();
    await Promise.resolve();

    expect(registerSW).not.toHaveBeenCalled();
  });

  it('prompts when a new worker is waiting, and accepting messages that worker', async () => {
    const { options } = await registerAndCaptureOptions();

    options.onNeedRefresh?.();
    expect(showUpdatePrompt).toHaveBeenCalledTimes(1);

    // The prompt's action: the plugin's own handle posts SKIP_WAITING.
    // Nothing here posts it, and nothing here reloads — reloading is the
    // `onNeedReload` step below, which is what keeps one deploy from
    // turning into two reloads.
    const accept = vi.mocked(showUpdatePrompt).mock.calls[0]![0];
    accept();
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads on activation only in the tab whose user accepted', async () => {
    const { options } = await registerAndCaptureOptions();

    options.onNeedRefresh?.();
    vi.mocked(showUpdatePrompt).mock.calls[0]![0]();
    options.onNeedReload?.();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(showUpdatedElsewherePrompt).not.toHaveBeenCalled();
  });

  it('prompts instead of force-reloading a tab that never accepted', async () => {
    const { options } = await registerAndCaptureOptions();

    // Another tab accepted; `clientsClaim()` handed this tab to the new
    // worker. Reloading here would discard a half-typed fee entry.
    options.onNeedReload?.();

    expect(reload).not.toHaveBeenCalled();
    expect(showUpdatedElsewherePrompt).toHaveBeenCalledTimes(1);

    vi.mocked(showUpdatedElsewherePrompt).mock.calls[0]![0]();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('re-checks for a deploy on an interval, but only while online', async () => {
    vi.useFakeTimers();
    try {
      const { options } = await registerAndCaptureOptions();
      // Returns a promise, like the real `ServiceWorkerRegistration.update()`
      // — the poll attaches a `.catch` to it.
      const update = vi.fn(() => Promise.resolve());
      options.onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(update).toHaveBeenCalledTimes(1);

      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(update).toHaveBeenCalledTimes(1);
      Reflect.deleteProperty(navigator, 'onLine');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads anyway when accepting never produces an activation', async () => {
    // `messageSkipWaiting()` silently does nothing when no worker is
    // waiting, so `onNeedReload` may never arrive. Without the watchdog
    // the user's click on "Reload" vanishes into no feedback at all.
    vi.useFakeTimers();
    try {
      const { options } = await registerAndCaptureOptions();
      options.onNeedRefresh?.();
      const accept = vi.mocked(showUpdatePrompt).mock.calls[0]![0];

      accept();
      expect(reload).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not stay latched as "accepted" after a failed acceptance', async () => {
    // The flag telling `onNeedReload` "I asked for this" must not survive
    // an acceptance that went nowhere. Latched, a *later* deploy accepted
    // in another tab would force-reload this one without asking — the
    // half-typed-fee-adjustment failure this flow exists to prevent.
    vi.useFakeTimers();
    try {
      const { options } = await registerAndCaptureOptions();
      options.onNeedRefresh?.();
      vi.mocked(showUpdatePrompt).mock.calls[0]![0]();
      await vi.advanceTimersByTimeAsync(5000);
      reload.mockClear();

      // A later deploy, accepted somewhere else.
      options.onNeedReload?.();

      expect(reload).not.toHaveBeenCalled();
      expect(showUpdatedElsewherePrompt).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a failed update check instead of leaking an unhandled rejection', async () => {
    // A 5xx or an aborted `sw.js` re-fetch is routine and un-actionable.
    // Left uncaught it becomes an `unhandledrejection`, which [8.12.7]'s
    // Sentry handler would report once an hour for every open tab.
    vi.useFakeTimers();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      const { options } = await registerAndCaptureOptions();
      const update = vi.fn(() => Promise.reject(new Error('502')));
      options.onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(update).toHaveBeenCalledTimes(1);
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      vi.useRealTimers();
    }
  });

  it('survives a browser that hands back no registration', async () => {
    const { options } = await registerAndCaptureOptions();
    expect(() => options.onRegisteredSW?.('/sw.js', undefined)).not.toThrow();
  });
});

describe('reloadForUpdate', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  function stubServiceWorker(registration: unknown) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.resolve(registration) },
    });
  }

  it('activates a waiting worker and lets the plugin own the reload', async () => {
    stubServiceWorker({ waiting: {} });
    const { options, reloadForUpdate } = await registerAndCaptureOptions();

    reloadForUpdate();
    await vi.waitFor(() => expect(updateSW).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();

    // ...and when it does, this tab counts as having accepted.
    options.onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain reload when no worker is waiting', async () => {
    // `messageSkipWaiting()` silently no-ops here, so without the fallback
    // the boundary's reload button would do nothing at all.
    stubServiceWorker({ waiting: null });
    const { reloadForUpdate } = await registerAndCaptureOptions();

    reloadForUpdate();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('reloads even in a browser with no service-worker support', async () => {
    const { reloadForUpdate } = await registerAndCaptureOptions();

    reloadForUpdate();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
