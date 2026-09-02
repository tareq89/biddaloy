/**
 * [8.11.10] — the tenant's audit trail, read-only.
 *
 * "Read-only" is a real constraint, not a description: this page renders
 * no button, menu item or link that changes anything. The only interactive
 * controls are the filters, the pagination `DataTable` owns, and the
 * per-row expand toggle. `GET /audit-logs` is `@Roles(ADMIN)` server-side.
 *
 * Its own inline permission gate (`useHasPermission(AUDIT_LOG_READ)`, an
 * `EmptyState` early-return) is gone as of [8.14.17]: `_staff.tsx`'s
 * `RequirePermission` now refuses this route in place before this
 * component ever mounts, using `STAFF_ROUTE_PERMISSIONS
 * ['/_staff/audit-logs/']` = `AUDIT_LOG_READ` (`route-permissions.ts`).
 * This route's more specific refusal copy (`auditLogs:forbidden.*`) still
 * ships — `_staff.tsx` passes it through as `RequirePermission`'s
 * `explanation` override — it just no longer lives in this file.
 *
 * Ordering is the server's — `created_at DESC`, newest first. Nothing here
 * re-sorts, and no column is sortable: a partial page re-sorted
 * client-side would silently misrepresent the trail's real order.
 */
import { AuditAction } from '@biddaloy/shared';
import {
  DatePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { auditLogsQueryOptions, useAuditLogs, type AuditLog } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate, formatDateTime, parseDate, toLatinDigits } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DiffPanel } from './-diff-panel';
import { changedFieldCount, shortEntityId } from './-humanize';

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * convention `invoices/index.tsx` and `students/index.tsx` use. */
const ALL_VALUE = '__all__';

/**
 * The `entity_type` strings the server actually writes today, read off
 * `server/src` rather than guessed from the entity list: offering a filter
 * value nothing ever produces is a filter that can only return "no
 * results". Kept alphabetical so the dropdown reads predictably.
 */
const ENTITY_TYPES = [
  'FeeStructure',
  'Invoice',
  'Payment',
  'ReminderBatch',
  'ReminderBatchPreview',
  'School',
  'Student',
  'User',
] as const;

/** The filter params this page owns, in one place: `setFilter` rebuilds
 * the whole set on every change (see its own comment), so the list and the
 * type have to stay in step. */
const FILTER_KEYS = ['action', 'entity_type', 'from_date', 'to_date'] as const;

type AuditLogFilters = {
  [K in (typeof FILTER_KEYS)[number]]?: string | undefined;
};

/** A URL can be hand-edited, bookmarked from an old session, or built by
 * a bug upstream. A date filter that isn't a real `YYYY-MM-DD` calendar
 * date is dropped rather than forwarded.
 *
 * The shape check alone is not enough, and the server is no backstop:
 * `@IsDateString` is `isISO8601`, which accepts `2026-02-30`, and the
 * date then normalizes to `2026-03-02` before the filter is applied. So
 * `?to_date=2026-02-30` would silently filter by a date nobody chose,
 * with an empty picker giving no hint that it happened. `parseDate` —
 * the same helper the `DatePicker` reads through — throws on exactly
 * those, so it decides here too. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

const auditLogsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  // Bounded to the server's own `@Max(100)`: `?limit=500` would 400 out of
  // `QueryAuditLogDto` and take the whole page down with it.
  limit: z.number().int().min(1).max(100).optional().catch(undefined),
  // Narrowed for the same reason — `?action=foo` fails the server's
  // `@IsEnum(AuditAction)`. `entity_type` stays a free string because the
  // column is a free-form varchar the server does not validate against a
  // list.
  action: z.enum(AuditAction).optional().catch(undefined),
  entity_type: z.string().optional().catch(undefined),
  from_date: z.string().refine(isRealCalendarDate).optional().catch(undefined),
  to_date: z.string().refine(isRealCalendarDate).optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection under
  // — must be declared here or TanStack Router's `validateSearch` strips
  // it from the URL on every navigation. This page has no bulk actions
  // (and, being read-only, never will), but the key still round-trips
  // through `useListShellState`.
  selected: z.string().optional().catch(undefined),
});

/** `validateSearch` has already dropped anything `parseDate` rejects, so
 * by the time a value reaches here it parses. The guard stays as a
 * belt-and-braces: this reads `filters`, which is typed as plain strings,
 * and a filter value must never take the page down. */
function parseFilterDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

function toAuditLogListFilters(filters: AuditLogFilters) {
  return {
    ...(filters.action !== undefined ? { action: filters.action as AuditLog['action'] } : {}),
    ...(filters.entity_type !== undefined ? { entityType: filters.entity_type } : {}),
    ...(filters.from_date !== undefined ? { fromDate: filters.from_date } : {}),
    ...(filters.to_date !== undefined ? { toDate: filters.to_date } : {}),
  };
}

export const Route = createFileRoute('/_staff/audit-logs/')({
  validateSearch: auditLogsSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    action: search.action,
    entityType: search.entity_type,
    fromDate: search.from_date,
    toDate: search.to_date,
  }),
  // The loader warms the cache; it is not the access gate — `_staff.tsx`'s
  // `RequirePermission` is, and it runs one layer up, around this route's
  // `Outlet`. `GET /audit-logs` is `@Roles(ADMIN)`, so a non-ADMIN whose
  // loader still fires (TanStack Router runs a matched route's loader
  // regardless of what its parent renders) gets a 403 here — and an
  // unhandled rejection would hand the route to the router's generic
  // error boundary instead of `RequirePermission`'s refusal copy.
  // Swallowing it leaves that decision to the parent gate; a genuine
  // failure for someone who *does* have the permission still surfaces,
  // because `useAuditLogs` refetches and `DataTable` renders its error
  // state.
  loader: ({ context: { queryClient }, deps }) =>
    queryClient
      .ensureQueryData(
        auditLogsQueryOptions({
          page: deps.page,
          limit: deps.limit,
          ...toAuditLogListFilters({
            action: deps.action,
            entity_type: deps.entityType,
            from_date: deps.fromDate,
            to_date: deps.toDate,
          }),
        }),
      )
      .catch(() => undefined),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const regionConfig = useTenantRegionConfig();

  // Timestamps render on the school's clock, not the viewer's — the same
  // reasoning `formatDateTime` documents for [8.11.8]'s login history.
  return (
    <RegionConfigProvider value={regionConfig}>
      <AuditLogsList />
    </RegionConfigProvider>
  );
}

function AuditLogsList() {
  const { t } = useTranslation('auditLogs');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as AuditLogFilters;

  const auditLogsQuery = useAuditLogs({
    page: state.page,
    limit: state.limit,
    ...toAuditLogListFilters(filters),
  });

  function setFilter(key: keyof AuditLogFilters, value: string | undefined) {
    // `null`, not a dropped key: `ListUrlStatePatch` treats an absent key
    // as "leave this param untouched", so deleting it would strand the old
    // value in the URL and leave "All actions" / a cleared date picker
    // unable to actually clear anything. Every key is restated, not just
    // the one that changed, so an unset filter is unambiguously `null`
    // rather than a hole the patch would skip over.
    const patch: Record<string, string | null> = {};
    for (const name of FILTER_KEYS) {
      patch[name] = filters[name] ?? null;
    }
    patch[key] = value ?? null;
    actions.setFilters(patch);
  }

  function entityLabel(entityType: string): string {
    // The server writes `entity_type` as a free-form varchar, so a value
    // with no translation is possible — fall back to the raw string
    // rather than rendering a missing-key path at an administrator.
    return t(`entityTypes.${entityType}`, { defaultValue: entityType });
  }

  function actionLabel(action: AuditLog['action']): string {
    return t(`actions.${action}`, { defaultValue: action });
  }

  /** The row's plain-language sentence. UPDATE is the only action whose
   * sentence depends on the payload (how many fields moved); every other
   * action has a fixed sentence, so the raw JSON never reaches a cell. */
  function summary(row: AuditLog): string {
    const entity = entityLabel(row.entity_type).toLocaleLowerCase();
    // Compared against the literal, not `AuditAction.UPDATE`: `AuditLog`
    // is generated from the OpenAPI document, so `row.action` is a plain
    // string union rather than the shared enum, and mixing the two is a
    // lint error (`no-unsafe-enum-comparison`) precisely because they are
    // different types that happen to share values.
    if (row.action === 'UPDATE') {
      return t('summaries.UPDATE', {
        count: changedFieldCount(row.old_values, row.new_values),
        entity,
      });
    }
    return t(`summaries.${row.action}`, { entity, defaultValue: actionLabel(row.action) });
  }

  function whenLabel(row: AuditLog): string {
    return formatDateTime(new Date(row.created_at), regionConfig);
  }

  const columns: DataTableColumn<AuditLog>[] = [
    {
      id: 'when',
      header: t('list.columnWhen'),
      accessorFn: (row) => whenLabel(row),
    },
    {
      id: 'who',
      header: t('list.columnWho'),
      // `null` covers three cases the server can't tell apart for the
      // reader (system-triggered, deleted user, relation not joined) —
      // all of them are "not a person you can name".
      accessorFn: (row) => row.performed_by_name ?? t('list.system'),
    },
    {
      id: 'action',
      header: t('list.columnAction'),
      // Plain translated text, not a `StatusBadge`: badges in this design
      // system carry a status *tone* (paid/overdue), and an audit action
      // is a taxonomy, not a state with a good/bad reading.
      accessorFn: (row) => actionLabel(row.action),
    },
    {
      id: 'what',
      header: t('list.columnWhat'),
      accessorFn: (row) => {
        const id = shortEntityId(row.entity_id);
        return id === null
          ? entityLabel(row.entity_type)
          : t('list.whatWithId', { entity: entityLabel(row.entity_type), id });
      },
    },
    {
      id: 'summary',
      header: t('list.columnSummary'),
      accessorFn: (row) => summary(row),
    },
  ];

  return (
    <ListShell
      title={t('list.title')}
      // The header slot every other list page fills with "Add…"/"Import…"
      // — this one has nothing to put there by design, so it carries the
      // explanation instead: the page is a record, not a workspace.
      primaryAction={<p className="text-sm text-muted-foreground">{t('list.readOnlyNote')}</p>}
      filterBar={
        <>
          <Select
            value={filters.action ?? ALL_VALUE}
            onValueChange={(value) => setFilter('action', value === ALL_VALUE ? undefined : value)}
          >
            <SelectTrigger aria-label={t('filters.actionLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('filters.allActions')}</SelectItem>
              {/* Derived from the shared enum, never a hand-written list —
                  [8.11.9] added REMINDER_PREVIEWED and an earlier
                  hardcoded list would have silently dropped it. */}
              {Object.values(AuditAction).map((action) => (
                <SelectItem key={action} value={action}>
                  {actionLabel(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.entity_type ?? ALL_VALUE}
            onValueChange={(value) =>
              setFilter('entity_type', value === ALL_VALUE ? undefined : value)
            }
          >
            <SelectTrigger aria-label={t('filters.entityTypeLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('filters.allEntityTypes')}</SelectItem>
              {ENTITY_TYPES.map((entityType) => (
                <SelectItem key={entityType} value={entityType}>
                  {entityLabel(entityType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* `toLatinDigits(formatDate(...))` — `formatDate` builds
              `YYYY-MM-DD` from local calendar fields (no UTC round-trip,
              so no day shift), and `toLatinDigits` strips Bangla numerals
              so the URL and the wire always carry an ISO date the server's
              `@IsDateString` accepts. Never `toISOString().slice(0, 10)`. */}
          <DatePicker
            aria-label={t('filters.fromDateLabel')}
            config={regionConfig}
            value={parseFilterDate(filters.from_date)}
            onValueChange={(date) =>
              setFilter(
                'from_date',
                date ? toLatinDigits(formatDate(date, regionConfig)) : undefined,
              )
            }
          />
          <DatePicker
            aria-label={t('filters.toDateLabel')}
            config={regionConfig}
            value={parseFilterDate(filters.to_date)}
            onValueChange={(date) =>
              setFilter('to_date', date ? toLatinDigits(formatDate(date, regionConfig)) : undefined)
            }
          />
        </>
      }
      tableId="audit-logs-list"
      caption={t('list.caption')}
      columns={columns}
      data={auditLogsQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => {
        // No sortable columns — see this file's header comment.
      }}
      page={state.page}
      pageSize={state.limit}
      totalCount={auditLogsQuery.data?.total ?? 0}
      onPageChange={actions.setPage}
      loading={auditLogsQuery.isLoading}
      {...(auditLogsQuery.isError ? { error: t('list.errorMessage') } : {})}
      emptyMessage={t('list.emptyMessage')}
      announceResults={(count, total) =>
        t('list.announceResults', { visible: count, total, count: total })
      }
      // A distinct accessible name per toggle — "Expand row" alone would
      // give every row in the table the same name.
      expandRowLabel={(row) =>
        t('list.expandLabel', { summary: summary(row), when: whenLabel(row) })
      }
      renderExpandedRow={(row) => (
        <DiffPanel oldValues={row.old_values} newValues={row.new_values} />
      )}
    />
  );
}
