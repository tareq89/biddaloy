import { shared } from './school-lock';
import { test as base } from './test';

export {
  SchoolSettingsLock,
  withSchoolSettingsLock,
  withSharedSchoolSettings,
} from './school-lock';
export type { LockOptions } from './school-lock';

/**
 * `test` for specs that CHANGE school-wide settings: an auto fixture holds the lock exclusively
 * for each test (`schoolSettingsMode: 'exclusive'` turns off the shared hold the base `test` takes for readers).
 * The fixture's own timeout covers the wait (it does not eat the test's timeout).
 * See school-lock.ts for the design.
 */
export const test = base.extend<{ schoolSettingsLock: void }>({
  schoolSettingsMode: 'exclusive',
  schoolSettingsLock: [
    async ({}, use) => {
      await shared.acquire();
      try {
        await use();
      } finally {
        shared.release();
      }
    },
    { auto: true, timeout: 5 * 60_000 + 30_000 },
  ],
});
