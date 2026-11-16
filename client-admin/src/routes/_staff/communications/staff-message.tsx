/**
 * [80.2.02] `/communications/staff-message` — message teachers and office staff by SMS.
 * Gated by `route-permissions.ts` (`STAFF_MESSAGE_SEND`); the component checks nothing itself.
 * `?people=<id>,<id>` (from the staff list, #4340) prefills "Pick people"; nothing is sent by the link.
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useActiveRole, useActiveTenant, useSchoolSettings } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { StaffMessageForm } from './-staff-message-form';

const UUID = z.string().uuid();
/** The server takes at most 500 people; a longer or malformed list is dropped, not guessed at. */
// The router writes the validated array back into the URL as JSON, so the next pass sees an array.
const peopleSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean)), z.array(z.string())])
  .pipe(z.array(UUID).min(1).max(500));

export const Route = createFileRoute('/_staff/communications/staff-message')({
  validateSearch: z.object({
    people: peopleSchema.optional().catch(undefined),
  }),
  loader: () => loadRouteNamespaces('communications', 'staff'),
  pendingComponent: StaffMessagePending,
  component: StaffMessagePage,
});

function StaffMessagePage() {
  // Phone numbers and counters render in the tenant's own region settings.
  const regionConfig = useTenantRegionConfig();
  const navigate = useNavigate();
  const { people } = Route.useSearch();
  // Clearing the prefill (people -> undefined) must keep the draft; only a new link changes the key.
  const formKey = React.useRef('');
  if (people) formKey.current = people.join(',');
  const role = useActiveRole();
  const tenantId = useActiveTenant();
  // Settings are ADMIN-only on the server; for others WhatsApp stays hidden.
  const settings = useSchoolSettings(role === 'ADMIN' ? (tenantId ?? '') : '');
  const whatsappConfigured = Boolean(settings.data?.communications?.whatsapp?.provider);
  return (
    <RegionConfigProvider value={regionConfig}>
      <PageContainer size="narrow">
        <StaffMessageForm
          // A new link with other people starts a fresh form.
          key={formKey.current}
          prefillIds={people}
          whatsappConfigured={whatsappConfigured}
          onClearPrefill={() =>
            void navigate({ to: '/communications/staff-message', search: {}, replace: true })
          }
          onSwitch={(next) => {
            if (next === 'guardians') void navigate({ to: '/communications/send' });
          }}
        />
      </PageContainer>
    </RegionConfigProvider>
  );
}

function StaffMessagePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
