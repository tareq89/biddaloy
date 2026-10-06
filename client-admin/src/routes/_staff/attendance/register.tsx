/**
 * [9.10] `/attendance/register` — a printable, paper-register replacement
 * for one section's whole month, over `GET /attendance/sections/
 * :sectionId/register-matrix` ([9.4]'s `useRegisterMatrix`, already used
 * by `reports.tsx`'s summary view). Client-only: no new backend surface.
 *
 * Deliberately a hand-written `<table>`, not `DataTable` — a
 * date-by-student matrix (one column per calendar day, up to 31 of them)
 * is not a list-of-rows-with-a-fixed-column-set the way every other
 * `DataTable` caller's data is, and `DataTable`'s column-visibility/
 * card-mode/sort machinery has nothing useful to offer a grid shaped like
 * this. It does still borrow `DataTable`'s design tokens (`text-sm`,
 * `border-border-subtle`, `tabular-nums`) so it reads as the same
 * product, not a one-off.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Label,
  MonthPicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TableCount,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useHasPermission,
  useRegisterMatrix,
  useSaveRegisterMatrix,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatDate, formatMonth, formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import { FileSpreadsheet, PencilIcon, PrinterIcon, SaveIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import {
  abbrev,
  RegisterEditGrid,
  statusLabel,
  toneClass,
  type Draft,
} from './-register-edit-grid';

import './-register-print.css';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const searchSchema = z.object({
  class_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
  month: z
    .string()
    .regex(MONTH_PATTERN)
    .optional()
    .catch(() => undefined),
  edit: z.coerce.boolean().optional().catch(undefined),
});

/** Default correction window (days) from `11-attendance.md`. Only decides
 * whether the reason field is marked required up front; the tenant's real
 * window is enforced by the server and its 422/403 shows under the field. */
const DEFAULT_WINDOW_DAYS = 2;

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `md` and up (768px) — edit mode is desktop-only (D14). */
function useIsMd(): boolean {
  const query = '(min-width: 768px)';
  const [matches, setMatches] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return matches;
}

export const Route = createFileRoute('/_staff/attendance/register')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('attendance', 'common'),
  component: RegisterPage,
});

function RegisterPage() {
  // `useRegionConfig()` has no ambient provider above the route tree —
  // same wrap `academic-years/index.tsx` documents for itself.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <RegisterPageContent />
    </RegionConfigProvider>
  );
}

function RegisterPageContent() {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const month = search.month ?? currentMonthIso();

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(search.class_id);
  const matrixQuery = useRegisterMatrix(search.section_id, month);

  const className = classesQuery.data?.data.find((klass) => klass.id === search.class_id)?.name;
  const sectionName = sectionsQuery.data?.find(
    (section) => section.id === search.section_id,
  )?.section_name;

  function patchSearch(
    patch: Partial<Record<'class_id' | 'section_id' | 'month', string | undefined>>,
  ) {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
    });
  }

  const rows = matrixQuery.data?.rows ?? [];
  const matrix = matrixQuery.data;
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  const isMd = useIsMd();
  const editing = search.edit === true && isMd && canMark && rows.length > 0;
  const saveMatrix = useSaveRegisterMatrix(search.section_id ?? '', month);

  // Changed cells only. A ref mirrors it so the route blocker (and a save
  // that clears the draft right before navigating) read the live value.
  const [draft, setDraftState] = React.useState<Draft>(new Map());
  const draftRef = React.useRef<Draft>(draft);
  const setDraft = (next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState(false);
  const [conflictDates, setConflictDates] = React.useState<string[] | null>(null);
  const today = localIso(new Date());

  // A new section, month or `?edit` starts a clean draft (the blocker below has
  // already asked before any of those navigations when the draft was not empty).
  // Keyed on `search.edit`, not `editing`: a viewport shrinking below `md` (or a
  // lost ATTENDANCE_MARK) only hides the grid — the draft stays, and the blocker
  // still asks before it is thrown away.
  React.useEffect(() => {
    setDraft(new Map());
    setReason('');
    setReasonError(false);
  }, [search.section_id, month, search.edit]);

  useWarnUnsavedChanges(draft.size > 0);
  const blocker = useBlocker({
    shouldBlockFn: () => draftRef.current.size > 0,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const changedDates = [...new Set([...draft.keys()].map((key) => key.split('|')[1] ?? ''))].sort();
  const oldestAllowed = localIso(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000));
  const outsideDates = changedDates.filter((date) => date < oldestAllowed);
  const newDates = matrix
    ? changedDates.filter((date) =>
        matrix.rows.every((row) => !(row.marks as Record<string, unknown>)[date]),
      )
    : [];
  const fmtDates = (dates: readonly string[]) =>
    dates.map((date) => formatDate(date, regionConfig)).join(', ');

  function leaveEdit() {
    void navigate({ search: (prev) => ({ ...prev, edit: undefined }) });
  }

  function onSave() {
    if (matrix === undefined || draft.size === 0 || saveMatrix.isPending) return;
    const trimmed = reason.trim();
    if (outsideDates.length > 0 && trimmed.length < 3) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    const days = changedDates.map((date) => ({
      date,
      base_version: matrix.versions[date] ?? null,
      entries: matrix.rows.flatMap((row) => {
        const status =
          draft.get(`${row.student_id}|${date}`) ??
          (row.marks as Record<string, AttendanceStatus | null | undefined>)[date];
        return status ? [{ student_id: row.student_id, status }] : [];
      }),
    }));
    saveMatrix.mutate(
      { client_request_id: crypto.randomUUID(), days, ...(trimmed ? { reason: trimmed } : {}) },
      {
        onSuccess: (result) => {
          toast.success(t('register.saved', { count: result.saved_dates.length }));
          setDraft(new Map());
          leaveEdit();
        },
        onError: (error) => {
          const details = error instanceof ApiError ? error.details : undefined;
          const code = details?.code;
          if (
            error instanceof ApiError &&
            (error.statusCode === 409 || code === 'ATTENDANCE_MATRIX_LOCKED_DATE')
          ) {
            // Stale day, reused request id, or locked date: nothing was saved.
            setConflictDates(Array.isArray(details?.dates) ? (details.dates as string[]) : []);
          } else if (code === 'ATTENDANCE_REASON_REQUIRED' || code === 'ATTENDANCE_WINDOW_CLOSED') {
            setReasonError(true);
          } else {
            toast.error(t('mark.errorToast'));
          }
        },
      },
    );
  }
  const monthLabel = formatMonth(month, regionConfig);
  const names = { className: className ?? '', sectionName: sectionName ?? '' };
  const caption = t('register.caption', { ...names, month: monthLabel });
  const cardTitle = t('register.cardTitle', { ...names, month: monthLabel });

  return (
    <PageContainer>
      <PageHeader
        title={t('register.title')}
        subtitle={
          editing
            ? `${t('register.editingSubtitle')} · ${className ?? ''} – ${sectionName ?? ''} · ${monthLabel}`
            : t('register.subtitle')
        }
        actions={[
          {
            id: 'print',
            label: t('register.print'),
            icon: <PrinterIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: !editing,
            disabled: rows.length === 0,
            onClick: () => window.print(),
          },
          {
            id: 'edit',
            label: t('register.edit'),
            icon: <PencilIcon aria-hidden="true" />,
            allowed: !editing && isMd && canMark && rows.length > 0,
            onClick: () => void navigate({ search: (prev) => ({ ...prev, edit: true }) }),
          },
          {
            id: 'cancel',
            label: t('register.cancel'),
            icon: <XIcon aria-hidden="true" />,
            allowed: editing,
            onClick: leaveEdit,
          },
          {
            id: 'save',
            label: t('register.save', { count: draft.size }),
            icon: <SaveIcon aria-hidden="true" />,
            priority: 'primary',
            allowed: editing,
            disabled: draft.size === 0,
            busy: saveMatrix.isPending,
            onClick: onSave,
          },
        ]}
      />

      <section aria-label={t('register.pickersLabel')} className="grid gap-4 md:grid-cols-12">
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-class">{t('register.classLabel')}</Label>
          <Select
            value={search.class_id ?? ''}
            onValueChange={(value) => patchSearch({ class_id: value, section_id: undefined })}
          >
            <SelectTrigger id="register-class">
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <SelectItem key={klass.id} value={klass.id}>
                  {klass.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-section">{t('register.sectionLabel')}</Label>
          <Select
            value={search.section_id ?? ''}
            onValueChange={(value) => patchSearch({ section_id: value })}
            disabled={search.class_id === undefined}
          >
            <SelectTrigger id="register-section" disabled={search.class_id === undefined}>
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(sectionsQuery.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.section_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-month">{t('register.monthLabel')}</Label>
          <MonthPicker
            id="register-month"
            aria-label={t('register.monthLabel')}
            value={month}
            onValueChange={(value) => patchSearch({ month: value })}
          />
        </div>
      </section>

      {search.section_id === undefined ? (
        <EmptyState
          icon={<FileSpreadsheet />}
          title={t('register.pickTitle')}
          explanation={t('register.selectPrompt')}
        />
      ) : matrixQuery.isPending ? (
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">{t('register.loading')}</span>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : matrixQuery.isError ? (
        <ErrorState
          message={t('register.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void matrixQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('register.emptyMessage')}
          explanation={t('register.emptyExplanation')}
        />
      ) : (
        <>
          {editing && matrix ? (
            <section
              aria-label={t('register.editingSubtitle')}
              className="grid gap-4 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:grid-cols-2 md:p-5"
            >
              <div className="grid content-start gap-2">
                <h2 className="text-h3" aria-live="polite">
                  {t('register.changedCount', { count: draft.size })}
                </h2>
                {newDates.length > 0 && (
                  <p className="text-sm text-text-secondary">
                    {t('register.newDayNotice', { dates: fmtDates(newDates) })}
                  </p>
                )}
                {outsideDates.length > 0 && (
                  <p className="text-sm text-text-secondary">
                    {t('register.outsideWindowNotice', { dates: fmtDates(outsideDates) })}
                  </p>
                )}
                <p className="text-caption text-text-secondary">{t('register.keysHint')}</p>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="register-reason">
                  {t('register.reasonLabel')}
                  {outsideDates.length > 0 && <span aria-hidden="true"> *</span>}
                </Label>
                <Textarea
                  id="register-reason"
                  rows={2}
                  value={reason}
                  required={outsideDates.length > 0}
                  aria-invalid={reasonError}
                  aria-describedby="register-reason-help"
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(false);
                  }}
                />
                <p
                  id="register-reason-help"
                  role={reasonError ? 'alert' : undefined}
                  className={
                    reasonError
                      ? 'text-caption text-destructive'
                      : 'text-caption text-text-secondary'
                  }
                >
                  {reasonError ? t('register.reasonRequired') : t('register.reasonHelp')}
                </p>
              </div>
            </section>
          ) : null}
          <section
            id="attendance-register-print-area"
            aria-labelledby="r-title"
            className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
          >
            <div className="flex flex-col gap-2 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5">
              <h2 id="r-title" className="text-h3">
                {cardTitle}
              </h2>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-text-secondary">
                {[
                  AttendanceStatus.PRESENT,
                  AttendanceStatus.ABSENT,
                  AttendanceStatus.LATE,
                  AttendanceStatus.LEAVE,
                ].map((status) => (
                  <span key={status}>
                    {abbrev(t, status)} = {statusLabel(t, status)}
                  </span>
                ))}
                <span>{t('register.legendClosed')}</span>
                <span>{t('register.legendUnmarked')}</span>
              </p>
            </div>
            {editing && matrix ? (
              <RegisterEditGrid
                matrix={matrix}
                draft={draft}
                onDraftChange={setDraft}
                today={today}
                caption={caption}
                onSave={onSave}
                onCancel={leaveEdit}
              />
            ) : (
              <>
                {!isMd && canMark && (
                  <p className="mx-4 mt-3 rounded-md bg-muted px-3 py-2 text-caption text-text-secondary print:hidden">
                    {t('register.phoneNotice')}
                  </p>
                )}
                <p className="px-4 py-3 text-caption text-text-secondary md:hidden print:hidden">
                  {t('register.scrollHint')}
                </p>
                <div
                  role="region"
                  aria-label={caption}
                  // WCAG SCR29: a scrollable `role="region"` needs a tab stop so a
                  // keyboard user can scroll it — same exemption `data-table.tsx`'s
                  // own table-mode wrapper carries, for the identical reason.
                  // `relative`: the `sr-only` header spans are `position: absolute`
                  // and would otherwise escape the `overflow-x-auto` and widen the page.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  tabIndex={0}
                  className="relative w-full overflow-x-auto"
                >
                  <table className="w-full border-collapse text-caption tabular-nums">
                    <caption className="sr-only">{caption}</caption>
                    <thead className="border-b border-border-subtle bg-muted text-text-secondary">
                      <tr>
                        <th scope="col" className="h-9 px-2 text-start font-medium">
                          {t('register.columnRoll')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-start font-medium">
                          {t('register.columnStudent')}
                        </th>
                        {matrixQuery.data?.dates.map((date) => (
                          <th
                            key={date.date}
                            scope="col"
                            className="h-9 min-w-6 text-center font-medium"
                          >
                            {!isMd && date.is_working_day && date.date <= today ? (
                              <Link
                                to="/attendance/$sectionId"
                                params={{ sectionId: search.section_id ?? '' }}
                                search={{ date: date.date }}
                                aria-label={t('register.openDay', {
                                  date: formatDate(date.date, regionConfig),
                                })}
                                className="inline-flex min-h-11 min-w-11 items-center justify-center text-primary underline"
                              >
                                {formatNumber(
                                  parseServerDate(date.date).getUTCDate(),
                                  regionConfig,
                                )}
                              </Link>
                            ) : (
                              <>
                                <span aria-hidden="true">
                                  {formatNumber(
                                    parseServerDate(date.date).getUTCDate(),
                                    regionConfig,
                                  )}
                                </span>
                                <span className="sr-only">
                                  {formatDate(date.date, regionConfig)}
                                </span>
                              </>
                            )}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="h-9 border-s border-border-subtle px-2 text-end font-medium"
                        >
                          {t('register.totalPresent')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalAbsent')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalLate')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalLeave')}
                        </th>
                        <th scope="col" className="h-9 px-2 text-end font-medium">
                          {t('register.totalPercentage')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {rows.map((row) => (
                        <tr key={row.student_id}>
                          <td className="h-9 px-2">
                            {formatNumber(row.roll_number, regionConfig)}
                          </td>
                          <td className="h-9 px-2 font-medium whitespace-nowrap">
                            {row.full_name}
                          </td>
                          {matrixQuery.data?.dates.map((date) => {
                            const status = (row.marks as Record<string, AttendanceStatus | null>)[
                              date.date
                            ];
                            if (!date.is_working_day) {
                              return (
                                <td
                                  key={date.date}
                                  className="h-9 bg-muted text-center text-text-secondary"
                                >
                                  <span aria-hidden="true">—</span>
                                  <span className="sr-only">{t('register.notWorkingDay')}</span>
                                </td>
                              );
                            }
                            return (
                              <td
                                key={date.date}
                                className={`h-9 text-center ${toneClass(status)}`}
                              >
                                <span aria-hidden="true">{status ? abbrev(t, status) : '·'}</span>
                                <span className="sr-only">
                                  {status ? statusLabel(t, status) : t('register.notMarked')}
                                </span>
                              </td>
                            );
                          })}
                          <td className="h-9 border-s border-border-subtle px-2 text-end">
                            {formatNumber(row.summary.present_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.absent_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.late_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {formatNumber(row.summary.leave_days, regionConfig)}
                          </td>
                          <td className="h-9 px-2 text-end">
                            {row.summary.attendance_percentage === null
                              ? '—'
                              : `${formatNumber(row.summary.attendance_percentage, regionConfig)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="border-t border-border-subtle px-4 py-3">
              <TableCount total={rows.length} />
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t('register.discardTitle')}
        description={t('register.discardBody', { count: draft.size })}
        confirmLabel={t('register.discardConfirm')}
        onConfirm={() => blocker.proceed?.()}
      />
      <Dialog
        open={conflictDates !== null}
        onOpenChange={(open) => !open && setConflictDates(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('register.conflictTitle')}</DialogTitle>
            <DialogDescription>
              {t('register.conflictBody', {
                dates: conflictDates?.length ? fmtDates(conflictDates) : monthLabel,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setDraft(new Map());
                setConflictDates(null);
                void matrixQuery.refetch();
              }}
            >
              {t('register.reload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
