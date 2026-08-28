/**
 * [8.12.3]. `CachedDataNotice` reads its state from a module-level map
 * (`api/freshness.ts`) rather than props, so each story seeds that map in
 * a decorator — the same call `offlineCachedQueryFn` makes at runtime, so
 * these stories exercise the real path rather than a props-only stand-in.
 */
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { clearFreshness, recordFreshness, type FreshnessSource } from '../api/freshness';

import { CachedDataNotice } from './cached-data-notice';

const QUERY_KEY = ['students', 'list', { page: 1 }];

function seed(source: FreshnessSource, ageMs: number): Decorator {
  const SeedDecorator: Decorator = (Story) => {
    clearFreshness();
    recordFreshness(QUERY_KEY, { fetchedAt: Date.now() - ageMs, source });
    return <Story />;
  };
  return SeedDecorator;
}

const meta: Meta<typeof CachedDataNotice> = {
  title: 'Components/CachedDataNotice',
  component: CachedDataNotice,
  tags: ['autodocs'],
  args: { queryKey: QUERY_KEY },
};

export default meta;
type Story = StoryObj<typeof CachedDataNotice>;

/**
 * Fresh data from the network renders **nothing at all** — this story is
 * deliberately blank. There is no "up to date" badge, because a notice
 * that is always on screen stops being read before the day it matters.
 */
export const FreshRendersNothing: Story = {
  decorators: [seed('network', 2_000)],
};

/** The service worker replayed a response it cached minutes ago. Looks
 * like an ordinary 200 to the app; only the `Date` header gives it away. */
export const CachedRecently: Story = {
  decorators: [seed('sw-cache', 5 * 60_000)],
};

/** Served out of the Dexie store, near the 24h expiry cap — the oldest
 * data this cache will ever hand back. */
export const CachedNearlyADayOld: Story = {
  decorators: [seed('dexie', 23 * 60 * 60_000)],
};

/**
 * The state this whole feature exists for: the connection is gone, the
 * list on screen came out of IndexedDB, and the user is told both facts.
 *
 * `navigator.onLine` is a read-only getter in a browser, so the offline
 * half is forced here the same way `ui/src/test/connectivity.ts` does it.
 */
export const OfflineWithCachedData: Story = {
  decorators: [
    function ForceOffline(Story) {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      return <Story />;
    },
    seed('dexie', 40 * 60_000),
  ],
};

export const RightToLeft: Story = {
  decorators: [seed('dexie', 3 * 60 * 60_000), rtlDecorator],
};
