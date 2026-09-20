// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { createI18nInstance, I18nProvider } from '../i18n';
import { whenReady } from '../i18n/i18n';

import { useEntityLabel } from './entity-label';

// `.ts`, not `.tsx` (per the ticket's `## Files`) — JSX is avoided below via
// `createElement` rather than switching the wrapper to `<I18nProvider>`.
function wrapperFor(i18n: ReturnType<typeof createI18nInstance>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    // `createElement`'s 3rd-arg form isn't usable here since `children` is
    // threaded through a destructured prop, not a literal.
    // eslint-disable-next-line react/no-children-prop
    return createElement(I18nProvider, { i18n, children });
  };
}

describe('useEntityLabel', () => {
  it('returns the English noun under the en locale', async () => {
    const i18n = createI18nInstance();
    await whenReady(i18n);
    await i18n.changeLanguage('en');
    const { result } = renderHook(() => useEntityLabel('class'), {
      wrapper: wrapperFor(i18n),
    });

    await waitFor(() => expect(result.current).toBe('Class'));
  });

  it('returns the Bengali noun under the bn locale', async () => {
    const i18n = createI18nInstance();
    await whenReady(i18n);
    await i18n.changeLanguage('bn');
    const { result } = renderHook(() => useEntityLabel('class'), {
      wrapper: wrapperFor(i18n),
    });

    await waitFor(() => expect(result.current).toBe('শ্রেণি'));
  });

  it('honours the plural form when count is 2', async () => {
    const i18n = createI18nInstance();
    await whenReady(i18n);
    await i18n.changeLanguage('en');
    const { result } = renderHook(() => useEntityLabel('class', { count: 2 }), {
      wrapper: wrapperFor(i18n),
    });

    await waitFor(() => expect(result.current).toBe('Classes'));
  });
});
