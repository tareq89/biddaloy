/**
 * [17.4.2] / [31.4] `/calendar` — the staff calendar. A month grid with a
 * selected-day panel and an upcoming panel (D26), term bands, a type/class
 * filter bar, and (ADMIN only, `CALENDAR_MANAGE`) create/edit/delete/publish
 * and a government holidays picker. The event form and the holidays picker
 * are full-page modals opened by `?panel=` (D22).
 */
import { CalendarEventType, Permission } from '@biddaloy/shared';
import {
  DayPanel,
  ErrorState,
  MonthGrid,
  type MonthGridEvent,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  calendarSettingsQueryOptions,
  downloadCalendarExport,
  useAcademicYears,
  useAddPublicHolidays,
  useCalendarEvent,
  useCalendarEvents,
  useCalendarSettings,
  useClasses,
  useCloneCalendar,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useHasPermission,
  usePublicHolidaySuggestions,
  usePublishCalendarEvent,
  useTerms,
  useUpdateCalendarEvent,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CopyIcon, DownloadIcon, FlagIcon, PlusIcon, UploadIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { CloneDialog } from './-clone-dialog';
import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormPage, type EventFormPayload } from './-event-form-dialog';
import { CalendarFilters } from './-filters';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';
import { UpcomingPanel } from './-upcoming-panel';
import { setPendingClonePreview } from './import';

export const calendarSearchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  types: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  panel: z.enum(['new-event', 'edit-event', 'holidays']).optional().catch(undefined),
  event_id: z.string().optional().catch(undefined),
});

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function splitMonth(month: string): { year: number; mo: number } {
  const parts = month.split('-').map(Number);
  return { year: parts[0] ?? 0, mo: parts[1] ?? 1 };
}

function monthRange(month: string): { from: string; to: string } {
  const { year, mo } = splitMonth(month);
  const from = new Date(Date.UTC(year, mo - 1, 1));
  from.setUTCDate(from.getUTCDate() - 7);
  const to = new Date(Date.UTC(year, mo, 0));
  to.setUTCDate(to.getUTCDate() + 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const Route = createFileRoute('/_staff/calendar/')({
  validateSearch: calendarSearchSchema,
  loader: ({ context: { queryClient } }) => {
    // No events prefetch here: `useCalendarEvents`'s real query key also
    // includes `types`/`classId`/`includeDrafts` (the last derived from a
    // permission check the loader has no access to), so a `{ from, to }`
    // -only prefetch can never match it — it would just be an extra,
    // wasted request rather than actually warming the cache the component
    // reads from.
    return Promise.all([
      queryClient.ensureQueryData(calendarSettingsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('calendar', 'calendarImport', 'common'),
    ]);
  },
  component: CalendarPage,
});

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarPage() {
  const { t } = useTranslation('calendar');
  const { t: tImport } = useTranslation('calendarImport');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const month = search.month ?? currentMonth();
  // Local calendar day (B20): `toISOString()` would read the UTC day.
  const today = toIsoDate(new Date());
  const [selectedDate, setSelectedDate] = React.useState(today);
  const types = React.useMemo(
    () => (search.types ? (search.types.split(',') as CalendarEventType[]) : []),
    [search.types],
  );
  const classId = search.class_id;

  const canManage = useHasPermission(Permission.CALENDAR_MANAGE);

  const { from, to } = monthRange(month);
  const eventsQuery = useCalendarEvents({ from, to, types, classId, includeDrafts: canManage });
  const settingsQuery = useCalendarSettings();
  const academicYearId = settingsQuery.data?.currentAcademicYear?.id;
  const termsQuery = useTerms(academicYearId);
  const classesQuery = useClasses(academicYearId ? { academic_year_id: academicYearId } : {});
  const holidayYear = Number(month.slice(0, 4));
  const suggestionsQuery = usePublicHolidaySuggestions(holidayYear);
  // Dedupe against the whole year, not just the visible month ±1 week —
  // a holiday added months ago must still show as already-added here.
  const yearHolidaysQuery = useCalendarEvents({
    from: `${holidayYear}-01-01`,
    to: `${holidayYear}-12-31`,
    types: [CalendarEventType.HOLIDAY],
    includeDrafts: canManage,
  });

  const events = eventsQuery.data?.data ?? [];

  const [detailsId, setDetailsId] = React.useState<string | undefined>(undefined);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const academicYearsQuery = useAcademicYears();
  const cloneMutation = useCloneCalendar();

  const editingId = search.panel === 'edit-event' ? search.event_id : undefined;
  const detailsEvent = useCalendarEvent(detailsId);
  const editingEvent = useCalendarEvent(editingId);

  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent(editingId ?? '');
  const deleteEvent = useDeleteCalendarEvent();
  const publishEvent = usePublishCalendarEvent();
  const addPublicHolidays = useAddPublicHolidays();

  function setSearch(patch: Partial<z.infer<typeof calendarSearchSchema>>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  }

  function closePanel() {
    createEvent.reset();
    updateEvent.reset();
    setSearch({ panel: undefined, event_id: undefined });
  }

  function onMonthChange(next: string) {
    setSearch({ month: next });
    // The selected day must sit inside the visible month.
    setSelectedDate(next === currentMonth() ? today : `${next}-01`);
  }

  // `EventFormPayload`'s optional fields are `T | undefined` (this
  // route's own `exactOptionalPropertyTypes`-safe shape); the server DTOs
  // declare those same fields as bare optional (`T?`, no explicit
  // `undefined`), so an explicit `undefined` value has to be stripped
  // before the object satisfies either mutation's input type.
  function dropUndefined<Target>(value: object): Target {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Target;
  }

  function handleCreateSubmit(payload: EventFormPayload) {
    createEvent.mutate(dropUndefined<CreateCalendarEventInput>(payload), {
      onSuccess: closePanel,
    });
  }

  function handleEditSubmit(payload: EventFormPayload) {
    // `UpdateCalendarEventDto` has no `publish` field, and the server's
    // global ValidationPipe rejects unknown properties — drop it before
    // sending an edit (publishing is its own separate action/endpoint).
    const { publish: _publish, ...editable } = payload;
    void _publish;
    updateEvent.mutate(dropUndefined<UpdateCalendarEventInput>(editable), {
      onSuccess: closePanel,
    });
  }

  const monthGridEvents: MonthGridEvent[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    typeLabel: t(`types.${event.type}`),
    name: event.name,
    startDate: event.start_date,
    endDate: event.end_date,
    ...(event.published
      ? {}
      : { badge: <StatusBadge tone="neutral" label={t('eventDetails.draft')} /> }),
  }));

  const eventsOn = (day: string) =>
    monthGridEvents.filter((event) => event.startDate <= day && event.endDate >= day);

  const termBands = (termsQuery.data ?? []).map((term) => ({
    id: term.id,
    name: term.name,
    startDate: term.start_date,
    endDate: term.end_date,
  }));

  const classOptions = (classesQuery.data?.data ?? []).map((cls) => ({
    id: cls.id,
    name: cls.name,
  }));

  if (eventsQuery.isError) {
    return (
      <ErrorState message={t('page.errorMessage')} onRetry={() => void eventsQuery.refetch()} />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('page.title')}
        actions={[
          {
            id: 'holidays',
            label: t('page.governmentHolidays'),
            icon: <FlagIcon />,
            priority: 'secondary',
            allowed: canManage,
            onClick: () => setSearch({ panel: 'holidays' }),
          },
          {
            id: 'import',
            label: tImport('toolbar.import'),
            icon: <UploadIcon />,
            priority: 'secondary',
            allowed: canManage,
            onClick: () => void navigate({ to: '/calendar/import' }),
          },
          {
            id: 'add',
            label: t('page.addEvent'),
            icon: <PlusIcon />,
            priority: 'primary',
            allowed: canManage,
            onClick: () => setSearch({ panel: 'new-event' }),
          },
          {
            id: 'clone',
            label: tImport('toolbar.clone'),
            icon: <CopyIcon />,
            priority: 'tertiary',
            allowed: canManage,
            onClick: () => setCloneOpen(true),
          },
          {
            id: 'export',
            label: tImport('toolbar.export'),
            icon: <DownloadIcon />,
            priority: 'tertiary',
            allowed: canManage && !!academicYearId,
            onClick: () => {
              if (academicYearId) void downloadCalendarExport(academicYearId, 'xlsx');
            },
          },
        ]}
      />

      <CalendarFilters
        types={types}
        onTypesChange={(next) => setSearch({ types: next.length ? next.join(',') : undefined })}
        classId={classId}
        onClassIdChange={(next) => setSearch({ class_id: next })}
        classOptions={classOptions}
      />

      {eventsQuery.isLoading ? (
        <Skeleton aria-busy="true" className="h-96 w-full" />
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <MonthGrid
            month={month}
            firstDayOfWeek={settingsQuery.data?.firstDayOfWeek ?? 0}
            weeklyOffDays={settingsQuery.data?.weeklyOffDays ?? [5, 6]}
            events={monthGridEvents}
            terms={termBands}
            weekdayLabels={WEEKDAY_KEYS.map((key) => t(`weekdays.${key}`, { defaultValue: key }))}
            moreLabel={(count) => t('page.moreEvents', { count })}
            selectedDate={selectedDate}
            today={today}
            onMonthChange={onMonthChange}
            onDayClick={setSelectedDate}
            onEventClick={setDetailsId}
          />
          <div className="flex flex-col gap-4 md:w-80 md:shrink-0 md:gap-6">
            <DayPanel
              date={selectedDate}
              events={eventsOn(selectedDate)}
              onEventClick={setDetailsId}
            />
            <UpcomingPanel events={events} today={today} onEventClick={setDetailsId} />
          </div>
        </div>
      )}

      {canManage && search.panel === 'new-event' && (
        <EventFormPage
          mode="create"
          isPending={createEvent.isPending}
          error={createEvent.error}
          onClose={closePanel}
          onSubmit={handleCreateSubmit}
        />
      )}

      {canManage && editingId && !editingEvent.data && (
        <FullPageShell
          title={t('eventForm.editTitle')}
          onClose={closePanel}
          primary={{ label: t('eventForm.save'), onClick: () => {}, disabled: true }}
        >
          {editingEvent.isError ? (
            <ErrorState
              message={t('page.errorMessage')}
              onRetry={() => void editingEvent.refetch()}
            />
          ) : (
            <Skeleton aria-busy="true" className="h-72 w-full" />
          )}
        </FullPageShell>
      )}

      {canManage && editingId && editingEvent.data && (
        <EventFormPage
          mode="edit"
          initialValues={editingEvent.data}
          isPending={updateEvent.isPending}
          error={updateEvent.error}
          onClose={closePanel}
          onSubmit={handleEditSubmit}
        />
      )}

      <EventDetailsSheet
        open={detailsId !== undefined}
        onOpenChange={(open) => {
          if (open) return;
          setDetailsId(undefined);
          deleteEvent.reset();
          publishEvent.reset();
        }}
        event={detailsEvent.data}
        canManage={canManage}
        deleting={deleteEvent.isPending}
        actionFailed={deleteEvent.isError || publishEvent.isError}
        onEdit={() => {
          setSearch({ panel: 'edit-event', event_id: detailsId });
          setDetailsId(undefined);
        }}
        onDelete={() => {
          if (detailsId)
            deleteEvent.mutate(detailsId, { onSuccess: () => setDetailsId(undefined) });
        }}
        onPublish={() => {
          if (detailsId) publishEvent.mutate(detailsId);
        }}
      />

      {canManage && (
        <GovernmentHolidaysDialog
          open={search.panel === 'holidays'}
          onOpenChange={(open) => {
            if (!open) setSearch({ panel: undefined });
          }}
          suggestions={suggestionsQuery.data ?? []}
          existingEvents={yearHolidaysQuery.data?.data ?? []}
          isPending={addPublicHolidays.isPending}
          onAdd={(entryIds) =>
            addPublicHolidays.mutate(entryIds, {
              onSuccess: () => setSearch({ panel: undefined }),
            })
          }
        />
      )}

      {canManage && (
        <CloneDialog
          open={cloneOpen}
          onOpenChange={setCloneOpen}
          academicYears={academicYearsQuery.data?.data ?? []}
          isPending={cloneMutation.isPending}
          error={cloneMutation.error}
          onSubmit={({ sourceYearId, targetYearId }) => {
            cloneMutation.mutate(
              { source_year_id: sourceYearId, target_year_id: targetYearId },
              {
                onSuccess: (preview) => {
                  setCloneOpen(false);
                  setPendingClonePreview(preview);
                  void navigate({ to: '/calendar/import' });
                },
              },
            );
          }}
        />
      )}
    </PageContainer>
  );
}
