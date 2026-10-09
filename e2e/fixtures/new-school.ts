import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  PlaywrightWorkerArgs,
} from '@playwright/test';

import { registerTrialSchool, type RegisteredSchool } from '../api';
import { shells } from '../config';
import { WelcomePage } from '../pages';
import { expect } from './test';

/**
 * [13.7.1] A trial school of the spec's own (registered over the API like a
 * stranger would), plus a browser page already signed in as its admin. For
 * every spec that mutates a school: the seeded ones are shared by other workers.
 * `api` is the request context that holds the admin's refresh cookie; keep it
 * for follow-up API calls and `dispose()` it when done.
 */
export interface NewSchool extends RegisteredSchool {
  api: APIRequestContext;
  context: BrowserContext;
  page: Page;
}

export async function newSchool(
  browser: Browser,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<NewSchool> {
  const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  // The caller only gets `api` back on success; on a failed setup nobody else can dispose it.
  try {
    const school = await registerTrialSchool(api);
    const state = await api.storageState();
    const context = await browser.newContext({
      storageState: {
        ...state,
        origins: [
          {
            origin: shells.app.baseURL.replace(/\/$/, ''),
            localStorage: [
              {
                name: 'biddaloy:activeTenant',
                value: JSON.stringify({ tenantId: school.session.tenantId, role: school.role }),
              },
            ],
          },
        ],
      },
    });
    return { ...school, api, context, page: await context.newPage() };
  } catch (err) {
    await api.dispose();
    throw err;
  }
}

/** A fresh school's first stop is `/welcome`; press "Do this later" so `/dashboard` and the
 * shell open. Runs in the default (bn) locale, which `WelcomePage` reads strings in. */
export async function skipSetup(page: Page): Promise<void> {
  const welcome = new WelcomePage(page);
  await page.goto('/welcome');
  await welcome.expectLoaded();
  await welcome.button('footer.later').click();
  await expect(page).toHaveURL(/\/dashboard/);
}
