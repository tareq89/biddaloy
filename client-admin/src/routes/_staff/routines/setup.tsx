/**
 * [21.7.1] `/routines/setup` — admin defines shifts, each shift's period
 * structure (with break/changeover), and the school's rooms, plus the
 * routine-wide changeover/cap settings. Cloned page structure from
 * `SchoolSettingsPage.tsx`: independently-saving sections stacked on one
 * page, gated by `STAFF_ROUTE_PERMISSIONS['/_staff/routines/setup']` =
 * `ROUTINE_MANAGE` (route-permissions.ts) before this component ever
 * mounts, same as `/settings`.
 */
import { getActiveTenant } from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import { useSchoolSettings, useShifts } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { PeriodSlotsPanel } from './-setup/period-slots-panel';
import { RoomsPanel } from './-setup/rooms-panel';
import { RoutineSettingsPanel } from './-setup/routine-settings-panel';
import { ShiftsPanel } from './-setup/shifts-panel';

export const Route = createFileRoute('/_staff/routines/setup')({
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
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold">{t('setupPage.title')}</h1>

      <ShiftsPanel selectedShiftId={selectedShift?.id} onSelectShift={setSelectedShiftId} />

      <PeriodSlotsPanel shift={selectedShift} changeoverGapMinutes={changeoverGapMinutes} />

      <RoomsPanel />

      <RoutineSettingsPanel schoolId={schoolId} />
    </div>
  );
}
