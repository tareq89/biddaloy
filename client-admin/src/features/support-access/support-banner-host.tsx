/**
 * [99.G4.02] Red bar for a tab Login as opened. Mounted above `AppShell` in both
 * shells, so it is on every page; the ui banner is `print:hidden`. Renders
 * nothing in a normal tab.
 */
import type { ImpersonationMeResponse } from '@biddaloy/shared';
import {
  ApiError,
  apiClient,
  clearAuthState,
  isSupportSession,
  readSupportEntry,
} from '@biddaloy/ui/api';
import { ImpersonationBanner } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useSupportCountdown } from './use-support-countdown';

/** Only a refusal ends the tab; a 500 or a dropped connection keeps the session and retries. */
const refused = (e: unknown) => {
  // An error without the API's full body stays a plain axios error; its status is on `response`.
  const status =
    e instanceof ApiError
      ? e.statusCode
      : (e as { response?: { status?: number } } | null)?.response?.status;
  return status === 401 || status === 403;
};
const END_TIMEOUT_MS = 5_000;

export function SupportBannerHost() {
  // Read once: the entry (and the flag) are cleared when the tab ends.
  const [entry] = useState(() => (isSupportSession() ? readSupportEntry() : null));
  const expiresAt = entry && entry !== 'expired' ? Date.parse(entry.expiresAt) : null;
  const remaining = useSupportCountdown(expiresAt);
  const { t } = useTranslation('supportBanner');
  const { t: tAuth } = useTranslation('auth');
  const me = useQuery({
    queryKey: ['support-access', 'me'],
    enabled: expiresAt !== null,
    retry: (count, e) => !refused(e) && count < 3,
    queryFn: async ({ signal }) =>
      (await apiClient.get<ImpersonationMeResponse>('/auth/impersonation/me', { signal })).data,
  });

  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    clearAuthState();
    window.close();
    // Hard navigation: clearing auth unmounts the shell, so the ended page is a public route.
    window.location.replace('/support/enter?ended=1');
  };
  const onEnd = () => {
    // Button: tell the server (best effort). At expiry the server has already ended it.
    const live = expiresAt !== null && Date.now() < expiresAt;
    if (!live) return finish();
    apiClient
      .post('/auth/impersonation/end', undefined, { timeout: END_TIMEOUT_MS })
      .then(finish, finish);
  };

  // Expired while closed, ran out while `me` was loading, or the server refused the token.
  const over = entry === 'expired' || remaining === 0 || refused(me.error);
  useEffect(() => {
    if (over) finish();
  }, [over]);
  // Wait for the name and role; never show an empty "as ,".
  if (remaining === null || !me.data) return null;

  return (
    <ImpersonationBanner
      message={t('banner.message', {
        name: me.data.userName,
        role: tAuth(`schoolPicker.roles.${me.data.role}`),
      })}
      {...(me.data.viewOnly ? { viewOnlyLabel: t('banner.viewOnly') } : {})}
      remainingSeconds={remaining}
      endLabel={t('banner.end')}
      warningLabel={remaining <= 60 ? t('banner.warnOne') : t('banner.warnFive')}
      onEnd={onEnd}
    />
  );
}
