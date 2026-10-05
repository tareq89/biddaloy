/**
 * [21.7.1] `/routines/setup` — admin defines shifts, each shift's period
 * structure (with break/changeover), and the school's rooms, plus the
 * routine-wide changeover/cap settings. Gated by
 * `STAFF_ROUTE_PERMISSIONS['/_staff/routines/setup']` = `ROUTINE_MANAGE`
 * (route-permissions.ts) before this component ever mounts, same as
 * `/settings`.
 *
 * [31.4] Three line tabs (shifts and periods / rooms / rules) so each view
 * has one job and one primary; the selected tab lives in `?tab=`.
 */
import { getActiveTenant } from '@biddaloy/ui/api';
import { RoutePending, Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useSchoolSettings, useShifts } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { PeriodSlotsPanel } from './-setup/period-slots-panel';
import { RoomsPanel } from './-setup/rooms-panel';
import { RoutineSettingsPanel } from './-setup/routine-settings-panel';
import { ShiftsPanel } from './-setup/shifts-panel';

const TABS = ['periods', 'rooms', 'rules'] as const;

const searchSchema = z.object({
  tab: z.enum(TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/setup')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  pendingComponent: RoutineSetupPending,
  component: RoutineSetupPage,
});

function RoutineSetupPending() {
  const { t } = useTranslation('routines');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

function RoutineSetupPage() {
  const { t } = useTranslation('routines');
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const tab = search.tab ?? 'periods';
  const schoolId = getActiveTenant() ?? '';
  const [selectedShiftId, setSelectedShiftId] = React.useState<string | undefined>(undefined);

  const shiftsQuery = useShifts();
  const settingsQuery = useSchoolSettings(schoolId);
  const routine = settingsQuery.data?.routine;
  const changeoverGapMinutes = routine?.defaultChangeoverMinutes ?? 5;

  const shifts = shiftsQuery.data?.data ?? [];
  const selectedShift =
    shifts.find((shift) => shift.id === selectedShiftId) ??
    (shifts.length > 0 ? shifts[0] : undefined);

  return (
    <PageContainer>
      <PageHeader title={t('setupPage.title')} subtitle={t('setupPage.subtitle')} />

      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            search: { tab: value === 'periods' ? undefined : (value as (typeof TABS)[number]) },
            replace: true,
          })
        }
      >
        <TabsList variant="line" aria-label={t('setupPage.tabsLabel')}>
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`setupPage.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="periods">
          <div className="space-y-6">
            <ShiftsPanel selectedShiftId={selectedShift?.id} onSelectShift={setSelectedShiftId} />
            <PeriodSlotsPanel shift={selectedShift} changeoverGapMinutes={changeoverGapMinutes} />
          </div>
        </TabsContent>
        <TabsContent value="rooms">
          <RoomsPanel />
        </TabsContent>
        <TabsContent value="rules">
          <RoutineSettingsPanel schoolId={schoolId} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
