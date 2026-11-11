/**
 * [69.5.01] `/promotions/$runId/groups` — set groups for many students at once (T3, S4).
 * A class teacher or an admin filters by GPA / one subject's marks, ticks the students (or
 * "Select all matching"), picks a group from the school's own list and applies it.
 *
 * The file is `$runId_.groups` (trailing underscore) so this is its own chromeless page, not a
 * child of the run page (which has no outlet). The server scopes the rows to a teacher's
 * homeroom sections and filters server-side (#3533), so nothing here narrows by role.
 * A teacher cannot read the run itself, so the page never needs it.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  closedYearErrorText,
  EmptyState,
  ErrorState,
  NoticeBar,
  StatusBadge,
  type DataTableColumn,
  DataTable,
} from '@biddaloy/ui/components';
import {
  promotionGroupEntriesQueryOptions,
  useHasPermission,
  useOrganisationVocabulary,
  usePromotionGroupEntries,
  useSetPromotionGroups,
  type PromotionGroupEntry,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { GroupsFilterBar, toGroupFilters } from './-groups/filter-bar';
import { GroupSelect } from './-groups/group-select';
import { NoSourceNotice } from './-groups/no-source-notice';

const PAGE_SIZE = 50;
/** The server's page cap, used when gathering every matching id. */
const ID_PAGE_SIZE = 100;
/** The server's per-call cap on `entry_ids`. */
const APPLY_CHUNK = 500;

export const Route = createFileRoute('/_staff/promotions/$runId_/groups')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('promotions', 'common', 'nav'),
  component: PromotionGroupsPage,
});

function PromotionGroupsPage() {
  const { runId } = Route.useParams();
  const { t } = useTranslation('promotions');
  const region = useRegionConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useHasPermission(Permission.PROMOTION_MANAGE);
  const canSettings = useHasPermission(Permission.SETTINGS_MANAGE);
  const close = useCloseFullPage(() => {
    if (canManage) void navigate({ to: '/promotions/$runId', params: { runId } });
    else void navigate({ to: '/my-class' });
  });

  const [values, setValues] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [group, setGroup] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [gathering, setGathering] = React.useState(false);
  const [subjects, setSubjects] = React.useState<readonly string[]>([]);

  const filters = toGroupFilters(values);
  const hasFilter = Object.keys(filters).length > 0;
  const query = usePromotionGroupEntries(runId, { ...filters, page, limit: PAGE_SIZE });
  const vocabulary = useOrganisationVocabulary();
  const setGroups = useSetPromotionGroups(runId);

  const pageRows = query.data?.data;
  const rows = React.useMemo(() => pageRows ?? [], [pageRows]);
  const total = query.data?.total ?? 0;
  const groups = vocabulary.data?.groups ?? [];
  const noSource = !hasFilter && rows.length > 0 && rows.every((r) => r.result.source === null);
  const subject = filters.subject_code;

  // A filtered answer can leave out subjects; keep every code seen so the picker never shrinks.
  React.useEffect(() => {
    const seen = rows.flatMap((r) => r.result.subjects.map((s) => s.subject_code));
    setSubjects((prev) => {
      const next = [...new Set([...prev, ...seen])].sort();
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  function changeFilters(patch: Record<string, string | null>) {
    setValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') delete next[key];
        else next[key] = value;
      }
      return next;
    });
    setPage(1);
    setSelected(new Set());
    setNotice(null);
  }

  async function selectAllMatching() {
    setGathering(true);
    try {
      const ids = new Set<string>();
      const pages = Math.max(1, Math.ceil(total / ID_PAGE_SIZE));
      for (let p = 1; p <= pages; p += 1) {
        const res = await queryClient.fetchQuery({
          ...promotionGroupEntriesQueryOptions(runId, { ...filters, page: p, limit: ID_PAGE_SIZE }),
          staleTime: 0,
        });
        for (const row of res.data) ids.add(row.entry_id);
      }
      setSelected(ids);
    } catch {
      setApplyError(t('groups.loadError'));
    } finally {
      setGathering(false);
    }
  }

  async function apply() {
    const ids = [...selected];
    if (ids.length === 0 || group === '') return;
    setApplyError(null);
    setNotice(null);
    try {
      for (let i = 0; i < ids.length; i += APPLY_CHUNK) {
        await setGroups.mutateAsync({
          entry_ids: ids.slice(i, i + APPLY_CHUNK),
          group_name: group,
        });
      }
      setSelected(new Set());
      setNotice(t('groups.applied', { n: formatNumber(ids.length, region) }));
    } catch (error) {
      setApplyError(closedYearErrorText(error, t('groups.applyFailed')));
    }
  }

  const dash = t('groups.emptyValue');
  const columns: DataTableColumn<PromotionGroupEntry>[] = [
    {
      id: 'student',
      header: t('groups.columnStudent'),
      accessorFn: (r) => r.student_name ?? dash,
      card: 'title',
    },
    {
      id: 'section',
      header: t('groups.columnSection'),
      accessorFn: (r) => r.source_section_name ?? dash,
      card: 'subtitle',
    },
    {
      id: 'gpa',
      header: t('groups.columnGpa'),
      accessorFn: (r) =>
        r.result.gpa === null ? dash : formatNumber(r.result.gpa, region, { decimals: 2 }),
      align: 'end',
      card: 'field',
    },
    ...(subject
      ? [
          {
            id: 'marks',
            header: t('groups.columnMarks', { subject }),
            accessorFn: (r: PromotionGroupEntry) => {
              const marks = r.result.subjects.find((s) => s.subject_code === subject)?.marks;
              return marks === undefined ? dash : formatNumber(marks, region, { decimals: 0 });
            },
            align: 'end' as const,
            card: 'field' as const,
          },
        ]
      : []),
    {
      id: 'source',
      header: t('groups.columnSource'),
      accessorFn: (r) =>
        r.result.source === null ? (
          dash
        ) : (
          <StatusBadge
            tone="neutral"
            label={t(
              r.result.source === 'FINAL_RESULT' ? 'groups.sourceFinal' : 'groups.sourceExam',
            )}
          />
        ),
      card: 'badge',
    },
    {
      id: 'group',
      header: t('groups.columnGroup'),
      accessorFn: (r) => r.group_name ?? t('groups.groupNone'),
      card: 'field',
    },
  ];

  const noGroups = vocabulary.isSuccess && groups.length === 0;
  const canApply = selected.size > 0 && group !== '';

  return (
    <FullPageShell title={t('groups.title')} onClose={close} size="wide">
      <div className="space-y-4">
        {notice && (
          <div role="status">
            <NoticeBar tone="info">{notice}</NoticeBar>
          </div>
        )}
        {applyError && (
          <div role="alert">
            <NoticeBar tone="danger">{applyError}</NoticeBar>
          </div>
        )}
        {noSource ? (
          <NoSourceNotice />
        ) : (
          <GroupsFilterBar
            subjects={subjects}
            values={values}
            onChange={changeFilters}
            resultCount={total}
          />
        )}
        {query.isError && !query.data ? (
          <ErrorState
            message={t('groups.loadError')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <DataTable
            tableId="promotion-groups"
            caption={t('groups.caption')}
            columns={columns}
            data={rows}
            getRowId={(r) => r.entry_id}
            sorting={null}
            onSortingChange={() => undefined}
            totalCount={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            loading={query.isPending}
            {...(noGroups || vocabulary.isPending
              ? {}
              : { selectedIds: selected, onSelectedIdsChange: setSelected })}
            emptyState={
              hasFilter
                ? { title: t('groups.noMatchTitle'), explanation: '', kind: 'no-results' }
                : { title: t('groups.emptyTitle'), explanation: t('groups.emptyBody') }
            }
          />
        )}
        {noGroups && (
          <EmptyState title={t('groups.noGroupsTitle')} explanation={t('groups.noGroupsHint')} />
        )}
        {noGroups && canSettings && (
          <Button asChild variant="outline">
            <Link to="/settings" search={{ section: 'school' }}>
              {t('groups.openSettings')}
            </Link>
          </Button>
        )}
      </div>
      {!noGroups && !vocabulary.isPending && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-col gap-3 border-t border-border-subtle bg-surface px-4 py-3 md:-mx-6 md:flex-row md:items-end md:px-6">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            loading={gathering}
            disabled={total === 0}
            onClick={() => void selectAllMatching()}
          >
            {t('groups.selectAllMatching', { n: formatNumber(total, region) })}
          </Button>
          <GroupSelect groups={groups} value={group} onChange={setGroup} />
          <span className="text-text-secondary md:ms-auto" aria-live="polite">
            {t('groups.selectedCount', { n: formatNumber(selected.size, region) })}
          </span>
          <Button
            type="button"
            className="h-11"
            loading={setGroups.isPending}
            disabled={!canApply}
            onClick={() => void apply()}
          >
            {t('groups.apply', { n: formatNumber(selected.size, region) })}
          </Button>
        </div>
      )}
    </FullPageShell>
  );
}
