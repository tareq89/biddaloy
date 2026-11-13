/**
 * [99.G4.01] Token intake for the tab Login as opens. The one-time code
 * arrives in the URL fragment; it is removed from the address bar before any
 * request, sent once, and never logged. The token lives in memory plus this
 * tab's sessionStorage (via `auth-state.ts`), never localStorage.
 */
import type { ImpersonationExchangeResponse, ImpersonationMeResponse } from '@biddaloy/shared';
import {
  API_BASE_URL,
  decodeAccessTokenMemberships,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
  setSupportSession,
  writeSupportEntry,
} from '@biddaloy/ui/api';
import axios from 'axios';

/** Reads `#code=…` and strips the fragment at once. Returns null if absent. */
export function takeFragmentCode(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const code = new URLSearchParams(hash.slice(1)).get('code');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return code && code.length > 0 ? code : null;
}

/** Swaps the code for a token and signs this tab in. Rejects on any failure
 * with an error that never carries the code. */
export async function enterSupportSession(code: string): Promise<void> {
  const { data } = await axios.post<ImpersonationExchangeResponse>(
    `${API_BASE_URL}/auth/impersonation/exchange`,
    { code },
  );
  const me = await axios.get<ImpersonationMeResponse>(`${API_BASE_URL}/auth/impersonation/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const memberships = decodeAccessTokenMemberships(data.access_token);
  const membership = memberships.find((m) => m.role === me.data.role) ?? memberships[0];
  if (!membership) throw new Error('support entry has no school');

  setSupportSession(true);
  setAccessToken(data.access_token);
  setActiveTenant(membership.tenantId);
  setActiveRole(membership.role);
  writeSupportEntry({
    token: data.access_token,
    sessionId: data.sessionId,
    expiresAt: data.expiresAt,
    tenantId: membership.tenantId,
    role: membership.role,
  });
}
