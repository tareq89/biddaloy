import { decodeAccessTokenMemberships, getActiveRole, getActiveTenant } from '@biddaloy/ui/api';
import { useAccessToken, useSchoolSettings, useSchools } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { EmailSection } from './settings/EmailSection';
import { MessengerSection } from './settings/MessengerSection';
import { RegionalSection } from './settings/RegionalSection';
import { SmsSection } from './settings/SmsSection';
import { WhatsAppSection } from './settings/WhatsAppSection';

/**
 * #8.7.13's dashboard: pick a school (super admin only — an ADMIN always
 * configures their own, no picker), then one `FormShell` per medium,
 * each saving independently. Reachability (the nav item, the permission
 * check) is `App.tsx`'s job, not this component's — this page assumes
 * the caller already has `SETTINGS_MANAGE` and renders unconditionally.
 *
 * "The school being configured is unmistakable on screen at all times"
 * (the issue's own acceptance criterion) is the banner right below the
 * picker — `sticky top-0` keeps it pinned at the viewport top as the
 * sections below scroll past, rather than just scrolling away with them,
 * so a long page never separates a form field from the name of the
 * school it belongs to.
 */
export function SchoolSettingsPage() {
  const { t } = useTranslation('settings');
  const isSuperAdmin = getActiveRole() === 'SUPER_ADMIN';
  const ownSchoolId = getActiveTenant();

  const schoolsQuery = useSchools({ enabled: isSuperAdmin });
  const schools = schoolsQuery.data;
  const [pickedSchoolId, setPickedSchoolId] = React.useState<string | undefined>(undefined);

  const schoolId = isSuperAdmin ? pickedSchoolId : (ownSchoolId ?? undefined);
  // An ADMIN's own school never appears in `schools` (that list is
  // SUPER_ADMIN-only — see `useSchools`'s own comment), but its name is
  // already sitting in the access token (`JwtMembership.name`, [8.9.5]) —
  // no separate fetch needed, and no raw UUID ever reaches the banner below.
  // `useAccessToken()`, not `getAccessToken()`: this must recompute after a
  // token refresh (`session.ts`'s proactive timer, or the request
  // interceptor's reactive 401 retry) carries a renamed school's fresh
  // membership name — a plain `getAccessToken()` read here would keep
  // showing the name from whichever token was current when this component
  // last rendered for an unrelated reason.
  const accessToken = useAccessToken();
  const ownSchoolName = React.useMemo(() => {
    if (!accessToken) return undefined;
    const membership = decodeAccessTokenMemberships(accessToken).find(
      (m) => m.tenantId === ownSchoolId,
    );
    if (!membership) return undefined;
    // A stale token from before `JwtMembership.name` existed (or one issued
    // just before a rename propagated) can still be valid for up to its
    // remaining lifetime — fall back rather than show a blank banner.
    return membership.name ?? t('unnamedSchool');
  }, [accessToken, ownSchoolId, t]);
  const schoolName = isSuperAdmin
    ? schools?.find((school) => school.id === schoolId)?.name
    : ownSchoolName;

  const settingsQuery = useSchoolSettings(schoolId ?? '');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>

      {isSuperAdmin && (
        <div className="grid gap-1.5">
          <label htmlFor="school-picker" className="text-sm font-medium">
            {t('schoolPicker.label')}
          </label>
          <select
            id="school-picker"
            className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
            value={pickedSchoolId ?? ''}
            onChange={(event) => setPickedSchoolId(event.target.value || undefined)}
          >
            <option value="">{t('schoolPicker.placeholder')}</option>
            {schools?.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
          {schoolsQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('schoolPicker.error')}
            </p>
          )}
        </div>
      )}

      {schoolId && schoolName && (
        <div
          role="status"
          className="sticky top-0 z-10 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium backdrop-blur-sm"
        >
          {t('configuringBanner', { schoolName })}
        </div>
      )}

      {schoolId && settingsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('settingsLoadError')}
        </p>
      )}

      {schoolId && settingsQuery.data && (
        <div className="flex flex-col gap-8">
          <RegionalSection schoolId={schoolId} region={settingsQuery.data.region} />
          <WhatsAppSection
            schoolId={schoolId}
            whatsapp={settingsQuery.data.communications?.whatsapp}
          />
          <MessengerSection
            schoolId={schoolId}
            messenger={settingsQuery.data.communications?.messenger}
          />
          <EmailSection schoolId={schoolId} email={settingsQuery.data.communications?.email} />
          <SmsSection schoolId={schoolId} sms={settingsQuery.data.communications?.sms} />
        </div>
      )}
    </div>
  );
}
