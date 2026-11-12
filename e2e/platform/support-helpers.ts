import type { APIRequestContext } from '@playwright/test';

import bnApproval from '../../ui/src/i18n/locales/bn/approval.json';
import bnAuth from '../../ui/src/i18n/locales/bn/auth.json';
import bnLoginAs from '../../ui/src/i18n/locales/bn/loginAs.json';
import bnSchoolsList from '../../ui/src/i18n/locales/bn/schoolsList.json';
import bnSupportAccess from '../../ui/src/i18n/locales/bn/supportAccess.json';
import bnSupportBanner from '../../ui/src/i18n/locales/bn/supportBanner.json';
import bnSupportWelcome from '../../ui/src/i18n/locales/bn/supportWelcome.json';
import { platformApiSession, type ApiSession } from '../api';
import { nextStepIn, totpNow } from '../totp';

/**
 * [99.6.02 / 99.6.03] Shared by the Login as specs (`platform/login-as.spec.ts`,
 * `journeys/support-access.spec.ts`): bn catalog lookup for the Epic 99 namespaces
 * (`e2e/i18n.ts` does not carry them) and the owner's API side of Login as.
 */
const catalogs = {
  approval: bnApproval,
  auth: bnAuth,
  loginAs: bnLoginAs,
  schoolsList: bnSchoolsList,
  supportAccess: bnSupportAccess,
  supportBanner: bnSupportBanner,
  supportWelcome: bnSupportWelcome,
};

/** `tc('loginAs', 'roles.ACCOUNTANT')`: the bn string, `{{var}}` filled from `vars`. */
export function tc(
  ns: keyof typeof catalogs,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  let node: unknown = catalogs[ns];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') throw new Error(`missing i18n key ${ns}:${key}`);
  return node.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars[n] ?? ''));
}

/** An authenticator code is single use per 30 s step, and sign-in already used this step's. */
export async function nextOwnerCode(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, nextStepIn() + 500));
  return totpNow();
}

/** The owner signed in over the API (own cookie jar, not the browser's). */
export const ownerSession = (request: APIRequestContext) => platformApiSession(request);

function bearer(session: ApiSession): Record<string, string> {
  return { Authorization: `Bearer ${session.token}` };
}

/** `POST /platform/step-up` for `platform.login_as`: waits for a fresh code, returns the token. */
export async function loginAsApproval(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  const res = await request.post('/api/v1/platform/step-up', {
    headers: bearer(session),
    data: { scope: 'platform.login_as', code: await nextOwnerCode() },
  });
  if (!res.ok()) throw new Error(`step-up ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { approval_token: string }).approval_token;
}

interface Candidates {
  candidates: { userId: string | null; name: string; unavailableReason: string | null }[];
}

export interface StartBody {
  schoolId: string;
  role: string;
  targetUserId: string;
  reason: string;
  viewOnly: boolean;
  ticketId?: string;
}

/** First person of `role` who can be chosen at this school. */
export async function firstCandidate(
  request: APIRequestContext,
  session: ApiSession,
  schoolId: string,
  role: string,
): Promise<string> {
  const res = await request.get(`/api/v1/platform/schools/${schoolId}/login-as/candidates`, {
    headers: bearer(session),
    params: { role },
  });
  if (!res.ok()) throw new Error(`candidates ${res.status()} ${await res.text()}`);
  const person = ((await res.json()) as Candidates).candidates.find(
    (c) => c.userId && !c.unavailableReason,
  );
  if (!person?.userId) throw new Error(`no ${role} to log in as at ${schoolId}`);
  return person.userId;
}

/** `POST /platform/impersonation` with a fresh step-up token. */
export async function startLoginAs(
  request: APIRequestContext,
  session: ApiSession,
  body: StartBody,
): Promise<{ id: string; status: string; code?: string }> {
  const token = await loginAsApproval(request, session);
  const res = await request.post('/api/v1/platform/impersonation', {
    headers: { ...bearer(session), 'X-Approval-Token': token },
    data: body,
  });
  if (!res.ok()) throw new Error(`start login as ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string; code?: string };
}

/** The one-time code in, the support access token out. */
export async function exchangeCode(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.post('/api/v1/auth/impersonation/exchange', { data: { code } });
  if (!res.ok()) throw new Error(`exchange ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
