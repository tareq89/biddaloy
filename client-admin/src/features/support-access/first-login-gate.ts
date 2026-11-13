/**
 * [99.G4.03] Decides whether a school admin must see `/welcome/support-access`
 * right after signing in (D3, D25). Only ADMIN, never a Login as tab.
 */
import { apiClient } from '@biddaloy/ui/api';
import type { SupportAccessSettings } from '@biddaloy/ui/hooks';

export const SUPPORT_WELCOME_PATH = '/welcome/support-access';

export function needsSupportWelcome(input: {
  role: string | null;
  supportSession: boolean;
  settings: Pick<SupportAccessSettings, 'confirmedAt' | 'textVersion' | 'currentTextVersion'>;
}): boolean {
  const { role, supportSession, settings } = input;
  if (role !== 'ADMIN' || supportSession) return false;
  return settings.confirmedAt === null || settings.textVersion < settings.currentTextVersion;
}

/** Where to go after sign-in: the welcome page (keeping the target) or the target itself.
 * Fails open: if the settings cannot be read the admin is not blocked from the app. */
export async function afterSignInTarget(
  role: string | null,
  supportSession: boolean,
  redirect: string | undefined,
): Promise<{ to: string; search?: { redirect: string } }> {
  const target = redirect ?? '/';
  if (role !== 'ADMIN' || supportSession) return { to: target };
  try {
    const { data } = await apiClient.get<SupportAccessSettings>('/support-access/settings');
    if (needsSupportWelcome({ role, supportSession, settings: data })) {
      return { to: SUPPORT_WELCOME_PATH, search: { redirect: target } };
    }
  } catch {
    // ponytail: fail open; the next sign-in asks again
  }
  return { to: target };
}
