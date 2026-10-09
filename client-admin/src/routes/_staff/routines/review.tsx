/**
 * [21.9.1] D11: the review screen for the current academic year's
 * routine (`Routine`'s unique `(tenant_id, academic_year_id)` index means
 * there is at most one, so no PUBLISHED/REVIEW/DRAFT ranking is needed
 * once scoped to the year — same year-scoping `ResolveRoutineService`
 * already does server-side). No per-class routine picker exists yet,
 * same one-active-routine assumption `$sectionId.tsx` makes when it
 * can't find a section-scoped one.
 *
 * Two audiences share this page:
 * - `ROUTINE_MANAGE` holders (ADMIN/EXECUTIVE) see every slot, the state
 *   controls (submit for review / withdraw / publish) and the change
 *   request queue.
 * - Everyone else (a teacher) sees only their own slots and can request a
 *   change on a published one — the server only accepts a change request
 *   against a `PUBLISHED` slot (`ChangeRequestsService.open`), so the
 *   action is hidden with an explanation otherwise, not just left to
 *   fail server-side.
 *
 * [31.4] The state is a `StatusBadge`; "who can see it" is a header fact.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useChangeRequests,
  useCopyRoutineYear,
  useCurrentUserId,
  useHasPermission,
  usePeriodSlotLookup,
  useRoutines,
  useRoutineSlots,
  useSectionLookup,
  useSubjects,
  useSubmitForReview,
  useTeachers,
  useWithdrawRoutine,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, PageHeader, type PageAction } from '@biddaloy/ui/shells';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  CalendarX2Icon,
  CopyIcon,
  GlobeIcon,
  SendIcon,
  Undo2Icon,
  UserRoundXIcon,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ChangeRequestDialog } from './-change-request-dialog';
import { ChangeRequestList } from './-change-request-list';
import { PublishDialog } from './-publish-dialog';
import { subjectName } from './-subject-name';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const ALL_SECTIONS = 'all';
const STATE_TONE = { DRAFT: 'neutral', REVIEW: 'warning', PUBLISHED: 'success' } as const;

const searchSchema = z.object({
  sectionId: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/review')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: RoutineReviewPage,
});

interface SlotRow {
  id: string;
  sectionId: string;
  sectionLabel: string;
  weekday: number;
  sequence: number;
  dayLabel: string;
  periodLabel: string;
  time: string;
  start: string;
  subject: string;
  teachers: string;
  teacherIds: string[];
}

function RoutineReviewPage() {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const canManage = useHasPermission(Permission.ROUTINE_MANAGE);
  const currentUserId = useCurrentUserId();

  const academicYearsQuery = useAcademicYears({});
  const currentYear = academicYearsQuery.data?.data.find((year) => year.is_current);
  const currentYearId = currentYear?.id;
  const routinesQuery = useRoutines();
  const routine = routinesQuery.data?.find(
    (candidate) => candidate.academic_year_id === currentYearId,
  );
  const slotsQuery = useRoutineSlots(routine?.id);
  const changeRequestsQuery = useChangeRequests(
    canManage && routine?.state === 'PUBLISHED' ? routine.id : undefined,
  );
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});
  const ownTeacherQuery = useTeachers(
    currentUserId ? { user_id: currentUserId, limit: 1 } : { limit: 1 },
  );
  const periodLookupQuery = usePeriodSlotLookup();
  const sectionLookupQuery = useSectionLookup();

  const submitForReview = useSubmitForReview(routine?.id ?? '');
  const withdraw = useWithdrawRoutine(routine?.id ?? '');
  const copyYear = useCopyRoutineYear(routine?.id ?? '');
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [changeRequestSlotId, setChangeRequestSlotId] = React.useState<string | null>(null);
  const [copyYearOpen, setCopyYearOpen] = React.useState(false);
  const [targetAcademicYearId, setTargetAcademicYearId] = React.useState('');
  const [page, setPage] = React.useState(1);

  const title = t('review.title');

  if (
    routinesQuery.isPending ||
    academicYearsQuery.isPending ||
    (!canManage && ownTeacherQuery.isPending)
  ) {
    return (
      <PageContainer>
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('review.loading')}</span>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-5 w-1/2" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }

  if (routinesQuery.isError || academicYearsQuery.isError) {
    return (
      <PageContainer>
        <PageHeader title={title} />
        <ErrorState
          message={t('review.error.message')}
          retryLabel={t('review.error.retry')}
          onRetry={() => {
            void routinesQuery.refetch();
            void academicYearsQuery.refetch();
          }}
        />
      </PageContainer>
    );
  }

  if (!routine) {
    return (
      <PageContainer>
        <PageHeader title={title} />
        <EmptyState
          icon={<CalendarX2Icon aria-hidden="true" />}
          title={t('review.noRoutineTitle')}
          explanation={t('review.noRoutineExplanation')}
        />
      </PageContainer>
    );
  }

  const ownTeacher = ownTeacherQuery.data?.data.find(
    (teacher) => teacher.user.id === currentUserId,
  );

  const rows: SlotRow[] = (slotsQuery.data ?? []).map((entry) => {
    const period = periodLookupQuery.data?.[entry.slot.period_slot_id];
    const section = sectionLookupQuery.data?.[entry.slot.section_id];
    const names = entry.teacher_ids
      .map((id) => teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name)
      .filter((name): name is string => Boolean(name));
    return {
      id: entry.slot.id,
      sectionId: entry.slot.section_id,
      sectionLabel: section
        ? t('review.slots.sectionName', {
            className: section.className,
            sectionName: section.sectionName,
          })
        : '—',
      weekday: entry.slot.weekday,
      sequence: period?.sequence ?? 0,
      dayLabel: t(`grid.weekday.${WEEKDAY_KEYS[entry.slot.weekday]}`),
      periodLabel: period
        ? t('agenda.periodLabel', { sequence: formatNumber(period.sequence, config) })
        : '—',
      time: period
        ? t('review.slots.timeRange', {
            start: formatTime(period.starts_at, config),
            end: formatTime(period.ends_at, config),
          })
        : '—',
      start: period ? formatTime(period.starts_at, config) : '—',
      subject: subjectName(
        subjectsQuery.data?.data.find((subject) => subject.id === entry.slot.subject_id),
        i18n.language,
      ),
      teachers: names.join(', ') || '—',
      teacherIds: entry.teacher_ids,
    };
  });
  rows.sort(
    (a, b) =>
      a.sectionLabel.localeCompare(b.sectionLabel) ||
      a.weekday - b.weekday ||
      a.sequence - b.sequence,
  );

  const sectionOptions = [
    ...new Map(rows.map((row) => [row.sectionId, row.sectionLabel] as const)),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const visibleRows = canManage
    ? rows.filter((row) => !search.sectionId || row.sectionId === search.sectionId)
    : rows.filter((row) => (ownTeacher ? row.teacherIds.includes(ownTeacher.id) : false));
  const pageSize = 25;
  const pagedRows = visibleRows.slice((page - 1) * pageSize, page * pageSize);

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const describeSlot = (slotId: string) => {
    const row = rowById.get(slotId);
    return row
      ? {
          when: t('changeRequestList.slotWhen', { day: row.dayLabel, period: row.periodLabel }),
          what: t('changeRequestList.slotWhat', { time: row.start, subject: row.subject }),
          section: row.sectionLabel,
        }
      : { when: '—', what: '—', section: '—' };
  };

  const bannerKey =
    routine.state === 'DRAFT'
      ? 'review.banner.draft'
      : routine.state === 'REVIEW'
        ? 'review.banner.review'
        : 'review.banner.published';
  const published = routine.state === 'PUBLISHED';
  const openRequests = (changeRequestsQuery.data ?? []).filter(
    (request) => request.state === 'OPEN',
  );

  function handleSubmitForReview() {
    submitForReview.mutate(undefined, {
      onSuccess: () => toast.success(t('review.stateChangedToast')),
      onError: () => toast.error(t('review.stateChangeErrorToast')),
    });
  }

  function handleWithdraw() {
    withdraw.mutate(undefined, {
      onSuccess: () => toast.success(t('review.stateChangedToast')),
      onError: () => toast.error(t('review.stateChangeErrorToast')),
    });
  }

  const actions: PageAction[] = canManage
    ? [
        {
          id: 'copy',
          label: t('review.copyYearAction'),
          icon: <CopyIcon />,
          priority: published ? 'secondary' : 'tertiary',
          onClick: () => setCopyYearOpen(true),
        },
        ...(routine.state === 'DRAFT'
          ? [
              {
                id: 'submit',
                label: t('review.submitForReviewAction'),
                icon: <SendIcon />,
                priority: 'primary' as const,
                busy: submitForReview.isPending,
                onClick: handleSubmitForReview,
              },
            ]
          : []),
        ...(routine.state === 'REVIEW'
          ? [
              {
                id: 'withdraw',
                label: t('review.withdrawAction'),
                icon: <Undo2Icon />,
                priority: 'secondary' as const,
                busy: withdraw.isPending,
                onClick: handleWithdraw,
              },
              {
                id: 'publish',
                label: t('review.publishAction'),
                icon: <GlobeIcon />,
                priority: 'primary' as const,
                onClick: () => setPublishOpen(true),
              },
            ]
          : []),
      ]
    : [];

  const columns: DataTableColumn<SlotRow>[] = [
    {
      id: 'section',
      header: t('review.slots.sectionColumn'),
      card: 'field',
      accessorFn: (row) => <span className="font-medium">{row.sectionLabel}</span>,
    },
    {
      id: 'day',
      header: t('review.slots.dayColumn'),
      card: 'title',
      accessorFn: (row) => row.dayLabel,
    },
    {
      id: 'period',
      header: t('review.slots.periodColumn'),
      card: 'subtitle',
      accessorFn: (row) => row.periodLabel,
    },
    {
      id: 'time',
      header: t('review.slots.timeColumn'),
      card: 'field',
      accessorFn: (row) => <span className="whitespace-nowrap">{row.time}</span>,
    },
    {
      id: 'subject',
      header: t('review.slots.subjectColumn'),
      card: 'field',
      accessorFn: (row) => row.subject,
    },
    {
      id: 'teachers',
      header: t('review.slots.teachersColumn'),
      card: 'field',
      accessorFn: (row) => row.teachers,
    },
  ];

  const slotsTitle = canManage ? t('review.slots.title') : t('review.slots.titleOwn');
  const showTable = canManage || ownTeacher;

  return (
    <>
      <DetailShell
        name={title}
        statusBadge={
          <StatusBadge
            tone={STATE_TONE[routine.state]}
            label={t(`review.stateLabel.${routine.state}`)}
          />
        }
        facts={[
          ...(currentYear ? [{ label: t('review.facts.year'), value: currentYear.name }] : []),
          {
            label: t('review.facts.periods'),
            value: t('review.facts.periodsValue', {
              count: formatNumber(visibleRows.length, config),
            }),
          },
          ...(canManage && published && changeRequestsQuery.data
            ? [
                {
                  label: t('review.facts.openRequests'),
                  value: t('review.facts.openRequestsValue', {
                    count: formatNumber(openRequests.length, config),
                  }),
                },
              ]
            : []),
          { label: t('review.facts.visibleTo'), value: t(bannerKey) },
        ]}
        actions={actions}
      >
        <div className="flex flex-col gap-6">
          {canManage && published && (
            <section className="space-y-3">
              <div>
                <h2 className="text-h2">{t('changeRequestList.title')}</h2>
                <p className="mt-1 text-text-secondary">
                  {t('changeRequestList.acceptDoesNotEditExplanation')}
                </p>
              </div>
              {changeRequestsQuery.isError ? (
                <ErrorState
                  message={t('changeRequestList.loadError')}
                  retryLabel={t('review.error.retry')}
                  onRetry={() => void changeRequestsQuery.refetch()}
                />
              ) : changeRequestsQuery.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ChangeRequestList
                  requests={changeRequestsQuery.data}
                  routineId={routine.id}
                  describeSlot={describeSlot}
                  requesterLabel={(userId) =>
                    teachersQuery.data?.data.find((teacher) => teacher.user.id === userId)?.user
                      .full_name ?? '—'
                  }
                />
              )}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
              <div>
                <h2 className="text-h2">{slotsTitle}</h2>
                <p className="mt-1 text-text-secondary">
                  {canManage ? t('review.slots.subtitle') : t('review.slots.subtitleOwn')}
                </p>
              </div>
              {canManage && (
                <div className="flex flex-col gap-1 md:w-72">
                  <Label htmlFor="review-section-filter">{t('review.slots.sectionFilter')}</Label>
                  <Select
                    value={search.sectionId ?? ALL_SECTIONS}
                    onValueChange={(value) => {
                      setPage(1);
                      void navigate({
                        to: '.',
                        search: { sectionId: value === ALL_SECTIONS ? undefined : value },
                        replace: true,
                      });
                    }}
                  >
                    <SelectTrigger id="review-section-filter" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SECTIONS}>{t('review.slots.allSections')}</SelectItem>
                      {sectionOptions.map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!canManage && ownTeacher && !published && (
              <p className="text-text-secondary">{t('review.requestChangeDisabledExplanation')}</p>
            )}

            {showTable ? (
              <DataTable
                tableId="routine-review-slots"
                caption={t('review.slots.caption')}
                columns={columns}
                data={pagedRows}
                getRowId={(row) => row.id}
                sorting={null}
                onSortingChange={() => {}}
                page={page}
                pageSize={pageSize}
                totalCount={visibleRows.length}
                onPageChange={setPage}
                loading={slotsQuery.isPending}
                {...(canManage
                  ? {}
                  : {
                      rowActions: (row: SlotRow) => [
                        {
                          intent: 'send' as const,
                          label: t('review.requestChangeAction'),
                          onClick: () => setChangeRequestSlotId(row.id),
                          allowed: published,
                        },
                      ],
                    })}
                emptyState={{
                  title: t('review.emptyTitle'),
                  explanation: t('review.emptyExplanation'),
                  ...(canManage
                    ? {
                        action: {
                          label: t('review.openClassRoutine'),
                          onClick: () => void navigate({ to: '/routines' }),
                        },
                      }
                    : {}),
                }}
              />
            ) : (
              <EmptyState
                icon={<UserRoundXIcon aria-hidden="true" />}
                title={t('review.notATeacherTitle')}
                explanation={t('review.notATeacherExplanation')}
              />
            )}
          </section>
        </div>
      </DetailShell>

      {changeRequestSlotId && (
        <ChangeRequestDialog
          open
          onOpenChange={(open) => !open && setChangeRequestSlotId(null)}
          routineId={routine.id}
          slotId={changeRequestSlotId}
          slotLabel={(() => {
            const row = rowById.get(changeRequestSlotId);
            return row ? `${row.dayLabel} · ${row.periodLabel} · ${row.subject}` : undefined;
          })()}
          onDone={() => setChangeRequestSlotId(null)}
        />
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} routineId={routine.id} />

      <Dialog open={copyYearOpen} onOpenChange={setCopyYearOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('review.copyYearDialogTitle')}</DialogTitle>
            <DialogDescription>{t('review.copyYearDialogExplanation')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <Label htmlFor="review-copy-target">{t('review.copyYearTargetLabel')}</Label>
            <Select value={targetAcademicYearId} onValueChange={setTargetAcademicYearId}>
              <SelectTrigger id="review-copy-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(academicYearsQuery.data?.data ?? [])
                  .filter((year) => year.id !== currentYearId)
                  .map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCopyYearOpen(false)}>
              {t('review.copyYearCancel')}
            </Button>
            <Button
              type="button"
              disabled={!targetAcademicYearId}
              loading={copyYear.isPending}
              onClick={() =>
                copyYear.mutate(
                  { target_academic_year_id: targetAcademicYearId },
                  {
                    onSuccess: (result) => {
                      toast.success(
                        t('review.copyYearSuccessToast', { count: result.skipped_slot_count }),
                      );
                      setCopyYearOpen(false);
                    },
                    onError: () => toast.error(t('review.copyYearErrorToast')),
                  },
                )
              }
            >
              {t('review.copyYearConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
