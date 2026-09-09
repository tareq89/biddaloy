import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listen, resetForTests } from './install-prompt-store';
import { useInstallPrompt } from './use-install-prompt';

const HINT_KEY = 'pwa-install-hint-dismissed';

function setUserAgent(ua: string, maxTouchPoints = 0): void {
  vi.stubGlobal('navigator', {
    ...navigator,
    userAgent: ua,
    maxTouchPoints,
  });
}

function fireBeforeInstallPrompt(): {
  prompt: () => Promise<void>;
  resolveChoice: (outcome: 'accepted' | 'dismissed') => void;
} {
  let resolveChoice!: (outcome: 'accepted' | 'dismissed') => void;
  const userChoice = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>(
    (resolve) => {
      resolveChoice = (outcome) => resolve({ outcome, platform: 'web' });
    },
  );
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = userChoice;
  window.dispatchEvent(event);
  return { prompt: event.prompt, resolveChoice };
}

function mockMatchMedia(standalone: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' ? standalone : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IOS_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  resetForTests();
  mockMatchMedia(false);
  setUserAgent(ANDROID_CHROME_UA);
  window.localStorage.clear();
  listen();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useInstallPrompt', () => {
  it('mode is "none" with no captured event and a non-iOS UA', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('mode is "prompt" once a beforeinstallprompt event is captured', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      fireBeforeInstallPrompt();
    });

    expect(result.current.mode).toBe('prompt');
  });

  it('mode is "ios-instructions" on iOS Safari with no captured event', () => {
    setUserAgent(IOS_SAFARI_UA);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('ios-instructions');
  });

  it('mode is "ios-instructions" on iPad reporting a Mac UA with touch points', () => {
    setUserAgent(IPAD_MAC_UA, 5);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('ios-instructions');
  });

  it('mode is "none" for a Mac UA without touch points (a real Mac)', () => {
    setUserAgent(IPAD_MAC_UA, 0);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('mode is "none" on other iOS browsers (e.g. Chrome for iOS)', () => {
    setUserAgent(IOS_CHROME_UA);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('mode is "none" when display-mode: standalone matches', () => {
    resetForTests();
    mockMatchMedia(true);
    listen();
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('mode is "none" after appinstalled fires, even with a captured event', () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      fireBeforeInstallPrompt();
    });
    expect(result.current.mode).toBe('prompt');

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.mode).toBe('none');
  });

  it('install() prompts, awaits userChoice, and clears the event afterward', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let captured!: ReturnType<typeof fireBeforeInstallPrompt>;
    act(() => {
      captured = fireBeforeInstallPrompt();
    });
    expect(result.current.mode).toBe('prompt');

    let installPromise!: Promise<'accepted' | 'dismissed'>;
    act(() => {
      installPromise = result.current.install();
    });
    captured.resolveChoice('accepted');
    const outcome = await installPromise;

    expect(captured.prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe('accepted');
    expect(result.current.mode).toBe('none');
  });

  it('a second beforeinstallprompt after install() re-enables mode: prompt', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let first!: ReturnType<typeof fireBeforeInstallPrompt>;
    act(() => {
      first = fireBeforeInstallPrompt();
    });

    let installPromise!: Promise<'accepted' | 'dismissed'>;
    act(() => {
      installPromise = result.current.install();
    });
    first.resolveChoice('dismissed');
    await installPromise;
    expect(result.current.mode).toBe('none');

    act(() => {
      fireBeforeInstallPrompt();
    });

    expect(result.current.mode).toBe('prompt');
  });

  it('install() with no captured event resolves "dismissed" without throwing', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await expect(result.current.install()).resolves.toBe('dismissed');
  });

  it('hintDismissed reads persisted localStorage state and dismissHint() persists it', () => {
    const { result, rerender } = renderHook(() => useInstallPrompt());
    expect(result.current.hintDismissed).toBe(false);

    act(() => {
      result.current.dismissHint();
    });
    rerender();

    expect(result.current.hintDismissed).toBe(true);
    expect(window.localStorage.getItem(HINT_KEY)).toBe('true');
  });

  it('does not throw when localStorage.getItem throws (e.g. private mode)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.hintDismissed).toBe(false);
    getItem.mockRestore();
  });

  it('does not throw when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useInstallPrompt());

    expect(() => {
      act(() => {
        result.current.dismissHint();
      });
    }).not.toThrow();
    expect(result.current.hintDismissed).toBe(true);
    setItem.mockRestore();
  });
});
