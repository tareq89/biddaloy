/**
 * [17.3.4] Terms tab — an academic year's grading periods (`AcademicTerm`),
 * ordered by `seq`: add/edit/delete plus up/down reorder. Read gated on
 * `CALENDAR_READ` (the tab itself — see `$academicYearId.tsx`'s own
 * conditional tab array), mutations gated on `CALENDAR_MANAGE` here, same
 * split the server controller enforces (`academic-terms.controller.ts`).
 *
 * Heading uses `termLabel` from `GET /calendar/settings` ("Semesters" for
 * a semester school, "Terms" default) rather than a hardcoded string —
 * `CalendarSection.tsx` is where that label is actually configured.
 *
 * The mutations live here, in the tab (which `DetailShell` keeps mounted once
 * visited), not in a row — a row can unmount mid-request after a reorder.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  RowActions,
  TableCount,
} from '@biddaloy/ui/components';
import {
  useCalendarSettings,
  useCreateTerm,
  useDeleteTerm,
  useHasPermission,
  useReorderTerms,
  useTerms,
  useUpdateTerm,
  type AcademicTerm,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  parseServerDate,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { ArrowDownIcon, ArrowUpIcon, CalendarRangeIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { Field } from '../-year-form-dialog';

import { TabQueryState } from './tab-query-state';

export interface TermsTabProps {
  academicYearId: string;
}

const ICON_BUTTON = 'size-11 md:size-8 text-text-secondary';

function termLabelI18nKey(termLabel: string | undefined): string {
  switch (termLabel) {
    case 'SEMESTER':
      return 'detail.terms.labelSemester';
    case 'TRIMESTER':
      return 'detail.terms.labelTrimester';
    default:
      return 'detail.terms.labelTerm';
  }
}

/** Whole calendar-day count between two `YYYY-MM-DD` server dates, rounded
 * up to the nearest week — a term that's exactly 7 days is "1 week", one
 * that's 8-14 days is "2 weeks", matching how a school actually talks
 * about term length. */
function lengthInWeeks(startDate: string, endDate: string): number {
  const start = parseServerDate(startDate).getTime();
  const end = parseServerDate(endDate).getTime();
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.ceil(days / 7));
}

export function TermsTab({ academicYearId }: TermsTabProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();
  const query = useTerms(academicYearId);
  const settingsQuery = useCalendarSettings();
  const canManage = useHasPermission(Permission.CALENDAR_MANAGE);

  const createTerm = useCreateTerm(academicYearId);
  const updateTerm = useUpdateTerm(academicYearId);
  const deleteTerm = useDeleteTerm(academicYearId);
  const reorderTerms = useReorderTerms(academicYearId);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingTerm, setEditingTerm] = React.useState<AcademicTerm | null>(null);
  const [deletingTerm, setDeletingTerm] = React.useState<AcademicTerm | null>(null);

  const heading = t(termLabelI18nKey(settingsQuery.data?.termLabel));

  function openForm(term: AcademicTerm | null) {
    createTerm.reset();
    updateTerm.reset();
    setEditingTerm(term);
    setFormOpen(true);
  }

  function handleReorder(terms: AcademicTerm[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= terms.length) return;
    const ids = terms.map((term) => term.id);
    const current = ids[index];
    const swapped = ids[target];
    if (current === undefined || swapped === undefined) return;
    ids[index] = swapped;
    ids[target] = current;
    reorderTerms.mutate(ids);
  }

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.terms.errorMessage')}
    >
      {(terms) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-h2">{heading}</h2>
              <p className="mt-0.5 text-text-secondary">{t('detail.terms.subtitle')}</p>
            </div>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => openForm(null)}
              >
                <PlusIcon aria-hidden="true" />
                {t('detail.terms.addTerm')}
              </Button>
            )}
          </div>

          {reorderTerms.isError && (
            <p role="alert" className="text-destructive">
              {t('detail.terms.reorderError')}
            </p>
          )}

          {terms.length === 0 ? (
            <EmptyState
              icon={<CalendarRangeIcon />}
              title={t('detail.terms.emptyMessage')}
              explanation={t('detail.terms.emptyExplanation')}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
              <table className="w-full">
                <thead className="hidden border-b border-border-subtle bg-muted text-start text-label text-text-secondary md:table-header-group">
                  <tr>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('detail.terms.columnSeq')}
                    </th>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('detail.terms.columnName')}
                    </th>
                    <th className="h-10 px-4 text-start font-medium">
                      {t('detail.terms.columnPeriod')}
                    </th>
                    <th className="h-10 px-4 text-end font-medium">
                      {t('detail.terms.columnLength')}
                    </th>
                    {canManage && (
                      <th className="h-10 px-4 text-end font-medium">
                        <span className="sr-only">{t('detail.terms.columnActions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {terms.map((term, index) => {
                    const period = formatDateRange(term.start_date, term.end_date, regionConfig);
                    const length = t('detail.terms.weekCount', {
                      count: lengthInWeeks(term.start_date, term.end_date),
                    });
                    return (
                      <tr key={term.id} className="flex flex-col hover:bg-muted md:table-row">
                        <td className="hidden h-10 px-4 py-1 tabular-nums md:table-cell">
                          {formatNumber(term.seq, regionConfig)}
                        </td>
                        <td className="block px-4 pt-3 md:table-cell md:h-10 md:py-1">
                          <span className="font-medium">{term.name}</span>
                          <span className="block text-caption text-text-secondary md:hidden">
                            {period} · {length}
                          </span>
                        </td>
                        <td className="hidden h-10 px-4 py-1 md:table-cell">{period}</td>
                        <td className="hidden h-10 px-4 py-1 text-end tabular-nums md:table-cell">
                          {length}
                        </td>
                        {canManage && (
                          <td className="block px-2 pb-1 md:table-cell md:h-10 md:py-1">
                            <div className="flex items-center justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={ICON_BUTTON}
                                aria-label={t('detail.terms.moveUp')}
                                disabled={index === 0 || reorderTerms.isPending}
                                onClick={() => handleReorder(terms, index, -1)}
                              >
                                <ArrowUpIcon className="size-4" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={ICON_BUTTON}
                                aria-label={t('detail.terms.moveDown')}
                                disabled={index === terms.length - 1 || reorderTerms.isPending}
                                onClick={() => handleReorder(terms, index, 1)}
                              >
                                <ArrowDownIcon className="size-4" aria-hidden="true" />
                              </Button>
                              <RowActions
                                actions={[
                                  {
                                    intent: 'edit',
                                    label: t('detail.terms.edit'),
                                    onClick: () => openForm(term),
                                  },
                                  {
                                    intent: 'delete',
                                    label: t('detail.terms.delete'),
                                    onClick: () => {
                                      deleteTerm.reset();
                                      setDeletingTerm(term);
                                    },
                                  },
                                ]}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-border-subtle px-4 py-3">
                <TableCount total={terms.length} />
              </div>
            </div>
          )}

          {/* Mounted only while open, so each open starts from fresh state. */}
          {canManage && formOpen && (
            <TermFormDialog
              mode={editingTerm ? 'edit' : 'create'}
              onClose={() => setFormOpen(false)}
              initialValues={
                editingTerm
                  ? {
                      name: editingTerm.name,
                      startDate: parseServerDate(editingTerm.start_date),
                      endDate: parseServerDate(editingTerm.end_date),
                    }
                  : undefined
              }
              isPending={editingTerm ? updateTerm.isPending : createTerm.isPending}
              error={editingTerm ? updateTerm.error : createTerm.error}
              onSubmit={(values) => {
                if (editingTerm) {
                  updateTerm.mutate(
                    { id: editingTerm.id, ...values },
                    { onSuccess: () => setFormOpen(false) },
                  );
                } else {
                  createTerm.mutate(values, { onSuccess: () => setFormOpen(false) });
                }
              }}
            />
          )}

          {canManage && deletingTerm && (
            <ConfirmDialog
              open
              onOpenChange={(open) => {
                if (!open && !deleteTerm.isPending) setDeletingTerm(null);
              }}
              title={t('detail.terms.deleteDialog.title')}
              description={`${t('detail.terms.deleteDialog.description', {
                name: deletingTerm.name,
              })}${deleteTerm.isError ? ` ${t('detail.terms.deleteDialog.errorMessage')}` : ''}`}
              confirmLabel={t('detail.terms.deleteDialog.confirm')}
              tone="danger"
              busy={deleteTerm.isPending}
              onConfirm={() =>
                deleteTerm.mutate(deletingTerm.id, { onSuccess: () => setDeletingTerm(null) })
              }
            />
          )}
        </div>
      )}
    </TabQueryState>
  );
}

interface TermFormValues {
  name: string;
  start_date: string;
  end_date: string;
}

interface TermFormInitialValues {
  name: string;
  startDate: Date;
  endDate: Date;
}

interface TermFormDialogProps {
  mode: 'create' | 'edit';
  initialValues?: TermFormInitialValues | undefined;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: TermFormValues) => void;
}

/** Maps the server's 422 `details.code` to the field it names, instead of
 * a generic error banner — `TERM_OVERLAP` points at the name field (its
 * message already names the other overlapping term), `TERM_OUTSIDE_ACADEMIC_YEAR`
 * points at the dates. See `academic-terms.service.ts`'s own docstrings on
 * both checks. Returns a translation key + interpolation params built from
 * `error.details` (not the server's own `error.message`, which is
 * English-only) for those two codes, and `null` for "no error"/anything
 * else, letting the caller supply its own generic fallback for the latter.
 * The server's ISO year bounds are shown as long-form dates (D5/D9). */
function termServerErrorDetail(
  error: unknown,
  regionConfig: RegionConfig,
): { key: string; params?: Record<string, string> } | null {
  if (!(error instanceof ApiError) || error.statusCode !== 422) return null;
  const details = error.details as
    { code?: string; name?: string; yearStart?: string; yearEnd?: string } | undefined;
  if (details?.code === 'TERM_OVERLAP' && details.name) {
    return { key: 'detail.terms.form.errorOverlap', params: { name: details.name } };
  }
  if (details?.code === 'TERM_OUTSIDE_ACADEMIC_YEAR' && details.yearStart && details.yearEnd) {
    return {
      key: 'detail.terms.form.errorOutsideYear',
      params: {
        yearStart: formatDate(details.yearStart, regionConfig),
        yearEnd: formatDate(details.yearEnd, regionConfig),
      },
    };
  }
  return null;
}

function TermFormDialog({
  mode,
  initialValues,
  isPending,
  error,
  onClose,
  onSubmit,
}: TermFormDialogProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();
  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [startDate, setStartDate] = React.useState<Date | undefined>(initialValues?.startDate);
  const [endDate, setEndDate] = React.useState<Date | undefined>(initialValues?.endDate);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  const isDirty =
    name !== (initialValues?.name ?? '') ||
    startDate?.getTime() !== initialValues?.startDate.getTime() ||
    endDate?.getTime() !== initialValues?.endDate.getTime();

  /** Every close path (Esc, X, outside, Cancel): never mid-request, ask first when edited. */
  function requestClose() {
    if (isPending) return;
    if (isDirty) setDiscardOpen(true);
    else onClose();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === '') {
      setValidationError(t('detail.terms.form.errorNameRequired'));
      return;
    }
    if (!startDate || !endDate) {
      setValidationError(t('detail.terms.form.errorDatesRequired'));
      return;
    }
    if (endDate < startDate) {
      setValidationError(t('detail.terms.form.errorEndBeforeStart'));
      return;
    }
    setValidationError(null);
    onSubmit({
      name: name.trim(),
      start_date: toIsoDate(startDate),
      end_date: toIsoDate(endDate),
    });
  }

  const title =
    mode === 'create' ? t('detail.terms.form.createTitle') : t('detail.terms.form.editTitle');
  const serverErrorDetail = termServerErrorDetail(error, regionConfig);
  const serverError = error
    ? serverErrorDetail
      ? t(serverErrorDetail.key, serverErrorDetail.params ?? {})
      : t('detail.terms.form.errorMessage')
    : null;

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && requestClose()}>
        <DialogContent size="sm" onInteractOutside={(e) => isPending && e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>

            <Field label={t('detail.terms.form.nameLabel')} htmlFor="term-form-name">
              <Input
                id="term-form-name"
                aria-required="true"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('detail.terms.form.startDateLabel')}>
                <DatePicker
                  aria-label={t('detail.terms.form.startDateLabel')}
                  config={regionConfig}
                  value={startDate}
                  onValueChange={setStartDate}
                />
              </Field>
              <Field label={t('detail.terms.form.endDateLabel')}>
                <DatePicker
                  aria-label={t('detail.terms.form.endDateLabel')}
                  config={regionConfig}
                  value={endDate}
                  onValueChange={setEndDate}
                />
              </Field>
            </div>

            {validationError && (
              <p role="alert" className="text-destructive">
                {validationError}
              </p>
            )}
            {!validationError && serverError && (
              <p role="alert" className="text-destructive">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={requestClose}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" loading={isPending}>
                {isPending ? t('detail.terms.form.saving') : t('detail.terms.form.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="default"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
