import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  PlaywrightWorkerArgs,
} from '@playwright/test';

import { registerTrialSchool, type RegisteredSchool } from '../api';
import { shells } from '../config';

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
}
