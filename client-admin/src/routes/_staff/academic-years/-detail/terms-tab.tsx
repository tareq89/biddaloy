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
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface TermsTabProps {
  academicYearId: string;
}

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
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{heading}</h2>
            {canManage && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEditingTerm(null);
                  setFormOpen(true);
                }}
              >
                {t('detail.terms.addTerm')}
              </Button>
            )}
          </div>

          {terms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.terms.emptyMessage')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.terms.columnSeq')}</TableHead>
                  <TableHead>{t('detail.terms.columnName')}</TableHead>
                  <TableHead>{t('detail.terms.columnStartDate')}</TableHead>
                  <TableHead>{t('detail.terms.columnEndDate')}</TableHead>
                  <TableHead>{t('detail.terms.columnLength')}</TableHead>
                  {canManage && (
                    <TableHead className="text-right">
                      {t('detail.terms.columnActions')}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((term, index) => (
                  <TableRow key={term.id}>
                    <TableCell>{term.seq}</TableCell>
                    <TableCell>{term.name}</TableCell>
                    <TableCell>
                      {formatDate(parseServerDate(term.start_date), regionConfig)}
                    </TableCell>
                    <TableCell>
                      {formatDate(parseServerDate(term.end_date), regionConfig)}
                    </TableCell>
                    <TableCell>
                      {t('detail.terms.weekCount', {
                        count: lengthInWeeks(term.start_date, term.end_date),
                      })}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('detail.terms.moveUp')}
                            disabled={index === 0 || reorderTerms.isPending}
                            onClick={() => handleReorder(terms, index, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('detail.terms.moveDown')}
                            disabled={index === terms.length - 1 || reorderTerms.isPending}
                            onClick={() => handleReorder(terms, index, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingTerm(term);
                              setFormOpen(true);
                            }}
                          >
                            {t('detail.terms.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingTerm(term)}
                          >
                            {t('detail.terms.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canManage && (
            <TermFormDialog
              open={formOpen}
              onOpenChange={setFormOpen}
              mode={editingTerm ? 'edit' : 'create'}
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

          {canManage && (
            <Dialog
              open={deletingTerm !== null}
              onOpenChange={(open) => {
                if (!open) setDeletingTerm(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('detail.terms.deleteDialog.title')}</DialogTitle>
                  <DialogDescription>
                    {t('detail.terms.deleteDialog.description', {
                      name: deletingTerm?.name ?? '',
                    })}
                  </DialogDescription>
                </DialogHeader>
                {deleteTerm.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('detail.terms.deleteDialog.errorMessage')}
                  </p>
                )}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      {t('actions.cancel', { ns: 'common' })}
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    loading={deleteTerm.isPending}
                    onClick={() => {
                      if (!deletingTerm) return;
                      deleteTerm.mutate(deletingTerm.id, {
                        onSuccess: () => setDeletingTerm(null),
                      });
                    }}
                  >
                    {deleteTerm.isPending
                      ? t('detail.terms.deleteDialog.deleting')
                      : t('detail.terms.deleteDialog.confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialValues?: TermFormInitialValues | undefined;
  isPending: boolean;
  error: unknown;
  onSubmit: (values: TermFormValues) => void;
}

/** Maps the server's 422 `details.code` to the field it names, instead of
 * a generic error banner — `TERM_OVERLAP` points at the name field (its
 * message already names the other overlapping term), `TERM_OUTSIDE_ACADEMIC_YEAR`
 * points at the dates. See `academic-terms.service.ts`'s own docstrings on
 * both checks. Returns the raw server message for those two codes (already
 * human-readable — see the service), and `null` for "no error"/anything
 * else, letting the caller supply its own generic fallback for the latter. */
function termServerErrorDetail(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.statusCode !== 422) return null;
  const code = (error.details as { code?: string } | undefined)?.code;
  if (code === 'TERM_OVERLAP' || code === 'TERM_OUTSIDE_ACADEMIC_YEAR') return error.message;
  return null;
}

function TermFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  isPending,
  error,
  onSubmit,
}: TermFormDialogProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();
  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [startDate, setStartDate] = React.useState<Date | undefined>(initialValues?.startDate);
  const [endDate, setEndDate] = React.useState<Date | undefined>(initialValues?.endDate);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(initialValues?.name ?? '');
    setStartDate(initialValues?.startDate);
    setEndDate(initialValues?.endDate);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function toLocalDateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
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
      start_date: toLocalDateString(startDate),
      end_date: toLocalDateString(endDate),
    });
  }

  const title = mode === 'create' ? t('detail.terms.form.createTitle') : t('detail.terms.form.editTitle');
  const serverErrorDetail = termServerErrorDetail(error);
  const serverError = error
    ? (serverErrorDetail ?? t('detail.terms.form.errorMessage'))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="term-form-name" className="text-sm font-medium">
              {t('detail.terms.form.nameLabel')}
            </label>
            <Input id="term-form-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('detail.terms.form.startDateLabel')}</span>
              <DatePicker
                aria-label={t('detail.terms.form.startDateLabel')}
                config={regionConfig}
                value={startDate}
                onValueChange={setStartDate}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('detail.terms.form.endDateLabel')}</span>
              <DatePicker
                aria-label={t('detail.terms.form.endDateLabel')}
                config={regionConfig}
                value={endDate}
                onValueChange={setEndDate}
              />
            </div>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {!validationError && serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {isPending ? t('detail.terms.form.saving') : t('detail.terms.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
