import { getActiveRole, getActiveTenant } from '@biddaloy/ui/api';
import { useSchoolSettings, useSchools } from '@biddaloy/ui/hooks';
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
 * picker — every section renders underneath it, so scrolling through a
 * long page never separates a form field from the name of the school
 * it belongs to.
 */
export function SchoolSettingsPage() {
  const { t } = useTranslation('settings');
  const isSuperAdmin = getActiveRole() === 'SUPER_ADMIN';
  const ownSchoolId = getActiveTenant();

  const { data: schools } = useSchools({ enabled: isSuperAdmin });
  const [pickedSchoolId, setPickedSchoolId] = React.useState<string | undefined>(undefined);

  const schoolId = isSuperAdmin ? pickedSchoolId : (ownSchoolId ?? undefined);
  const schoolName = isSuperAdmin
    ? schools?.find((school) => school.id === schoolId)?.name
    : undefined;

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
            className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
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
        </div>
      )}

      {schoolId && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium"
        >
          {t('configuringBanner', { schoolName: schoolName ?? schoolId })}
        </div>
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
