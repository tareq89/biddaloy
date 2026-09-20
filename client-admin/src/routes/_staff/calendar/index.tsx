/**
 * [17.4.2] `/calendar` — the staff calendar. Month grid on desktop,
 * agenda list on narrow viewports (both always mounted, `view` search
 * param picks which one paints — see the `md:hidden`/`hidden md:block`
 * wrap below); term bands, a type/class filter bar, and (ADMIN only,
 * `CALENDAR_MANAGE`) create/edit/delete/publish and a government
 * holidays picker.
 */
import { CalendarEventType, Permission } from '@biddaloy/shared';
import { Button, ErrorState, Skeleton } from '@biddaloy/ui/components';
import {
  calendarSettingsQueryOptions,
  useAddPublicHolidays,
  useCalendarEvent,
  useCalendarEvents,
  useCalendarSettings,
  useClasses,
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
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { AgendaList, type AgendaEvent } from '../../../components/calendar/agenda-list';
import { MonthGrid, type MonthGridEvent } from '../../../components/calendar/month-grid';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormDialog, type EventFormPayload } from './-event-form-dialog';
import { CalendarFilters } from './-filters';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';
import { UpcomingPanel } from './-upcoming-panel';

export const calendarSearchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  types: z.string().optional().catch(undefined),
  view: z.enum(['grid', 'agenda']).optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
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

function addMonths(month: string, delta: number): string {
  const { year, mo } = splitMonth(month);
  const date = new Date(Date.UTC(year, mo - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
      loadRouteNamespaces('calendar', 'common'),
    ]);
  },
  component: CalendarPage,
});

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarPage() {
  const { t } = useTranslation('calendar');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const month = search.month ?? currentMonth();
  const view = search.view ?? 'grid';
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

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | undefined>(undefined);
  const [detailsId, setDetailsId] = React.useState<string | undefined>(undefined);
  const [governmentHolidaysOpen, setGovernmentHolidaysOpen] = React.useState(false);

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
      onSuccess: () => setCreateOpen(false),
    });
  }

  function handleEditSubmit(payload: EventFormPayload) {
    // `UpdateCalendarEventDto` has no `publish` field, and the server's
    // global ValidationPipe rejects unknown properties — drop it before
    // sending an edit (publishing is its own separate action/endpoint).
    const { publish: _publish, ...editable } = payload;
    void _publish;
    updateEvent.mutate(dropUndefined<UpdateCalendarEventInput>(editable), {
      onSuccess: () => setEditingId(undefined),
    });
  }

  const monthGridEvents: MonthGridEvent[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    typeLabel: t(`types.${event.type}`),
    name: event.name,
    startDate: event.start_date,
    endDate: event.end_date,
  }));

  const agendaEvents: AgendaEvent[] = monthGridEvents;

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
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t('page.title')}</h1>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGovernmentHolidaysOpen(true)}
                >
                  {t('page.governmentHolidays')}
                </Button>
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  {t('page.addEvent')}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('page.previousMonth')}
              onClick={() => setSearch({ month: addMonths(month, -1) })}
            >
              {'<'}
            </Button>
            <span className="text-sm font-medium">{month}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('page.nextMonth')}
              onClick={() => setSearch({ month: addMonths(month, 1) })}
            >
              {'>'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearch({ month: currentMonth() })}
            >
              {t('page.today')}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={view === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSearch({ view: 'grid' })}
            >
              {t('page.viewGrid')}
            </Button>
            <Button
              type="button"
              variant={view === 'agenda' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSearch({ view: 'agenda' })}
            >
              {t('page.viewAgenda')}
            </Button>
          </div>
        </div>

        <CalendarFilters
          types={types}
          onTypesChange={(next) => setSearch({ types: next.length ? next.join(',') : undefined })}
          classId={classId}
          onClassIdChange={(next) => setSearch({ class_id: next })}
          classOptions={classOptions}
        />

        {eventsQuery.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <div className={view === 'grid' ? 'hidden md:block' : 'hidden'}>
              <MonthGrid
                month={month}
                firstDayOfWeek={settingsQuery.data?.firstDayOfWeek ?? 0}
                weeklyOffDays={settingsQuery.data?.weeklyOffDays ?? [5, 6]}
                events={monthGridEvents}
                terms={termBands}
                weekdayLabels={WEEKDAY_KEYS.map((key) =>
                  t(`weekdays.${key}`, { defaultValue: key }),
                )}
                moreLabel={(count) => t('page.moreEvents', { count })}
                onEventClick={setDetailsId}
              />
            </div>
            <div className={view === 'agenda' ? 'block' : 'block md:hidden'}>
              <AgendaList
                events={agendaEvents}
                formatDayHeading={(day) => day}
                emptyLabel={t('page.agendaEmpty')}
                onEventClick={setDetailsId}
              />
            </div>
          </>
        )}
      </div>

      <div className="w-full md:w-64">
        <UpcomingPanel
          events={events}
          today={new Date().toISOString().slice(0, 10)}
          onEventClick={setDetailsId}
        />
      </div>

      {canManage && (
        <EventFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          isPending={createEvent.isPending}
          error={createEvent.error}
          onSubmit={handleCreateSubmit}
        />
      )}

      {canManage && editingId && (
        <EventFormDialog
          open={editingId !== undefined}
          onOpenChange={(open) => !open && setEditingId(undefined)}
          mode="edit"
          initialValues={editingEvent.data}
          isPending={updateEvent.isPending}
          error={updateEvent.error}
          onSubmit={handleEditSubmit}
        />
      )}

      <EventDetailsSheet
        open={detailsId !== undefined}
        onOpenChange={(open) => !open && setDetailsId(undefined)}
        event={detailsEvent.data}
        canManage={canManage}
        onEdit={() => {
          setEditingId(detailsId);
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
          open={governmentHolidaysOpen}
          onOpenChange={setGovernmentHolidaysOpen}
          suggestions={suggestionsQuery.data ?? []}
          existingEvents={yearHolidaysQuery.data?.data ?? []}
          isPending={addPublicHolidays.isPending}
          onAdd={(entryIds) =>
            addPublicHolidays.mutate(entryIds, {
              onSuccess: () => setGovernmentHolidaysOpen(false),
            })
          }
        />
      )}
    </div>
  );
}
