/**
 * [38.4.1] "Log fine" — one FINE-type fee structure charged to one or more
 * students at once. Shares the Fines page, a student's Fines tab, and the
 * command palette (per U7). Structurally cloned from
 * `client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx`
 * (student search + chips) — see the plan comment on #1119 for why that
 * file's path in the ticket body was wrong.
 */
import { FeeType } from '@biddaloy/shared';
import {
  ApiError,
  captureNotificationTenant,
  notifyOutcome,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useDebouncedValue,
  useFeeStructures,
  useLogFine,
  useStudentSearch,
  studentQueryOptions,
  type AcademicYear,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { minorUnitsToDecimalString, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import * as React from 'react';

const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 280;
const MAX_STUDENTS = 20;

export interface LogFineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects these students (e.g. opened from a student's Fines tab). */
  prefillStudentIds?: string[];
}

interface SelectedStudent {
  id: string;
  full_name: string;
}

function todayDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function describeSubmitError(error: unknown, t: TFunction<'fines'>): string {
  if (error instanceof RateLimitedError) return t('logForm.errorMessage');
  if (error instanceof ApiError) return error.message;
  return t('logForm.errorMessage');
}

export function LogFineModal({ open, onOpenChange, prefillStudentIds }: LogFineModalProps) {
  const { t } = useTranslation('fines');
  const config = useRegionConfig();

  const [selected, setSelected] = React.useState<SelectedStudent[]>([]);
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [feeStructureId, setFeeStructureId] = React.useState('');
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(undefined);
  const [amountTouched, setAmountTouched] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [incidentDate, setIncidentDate] = React.useState(todayDateInputValue());
  const [notifyFamilies, setNotifyFamilies] = React.useState(true);

  const yearsQuery = useAcademicYears();
  const academicYears = yearsQuery.data?.data ?? [];
  const currentYear = academicYears.find((year: AcademicYear) => year.is_current);

  const feeStructuresQuery = useFeeStructures({
    academic_year_id: currentYear?.id ?? '',
    fee_type: FeeType.FINE,
  });
  const fineTypes = feeStructuresQuery.data?.data ?? [];
  const selectedFeeStructure = fineTypes.find((structure) => structure.id === feeStructureId);

  // Amount follows the chosen fine type until the accountant edits it
  // directly — same "default until touched" rule `generate-fees-modal.tsx`
  // uses for its due date.
  React.useEffect(() => {
    if (amountTouched || selectedFeeStructure === undefined) return;
    setAmountMinorUnits(serverAmountToMinorUnits(selectedFeeStructure.amount, config));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only, not a controlled sync
  }, [selectedFeeStructure]);

  const searchQuery = useStudentSearch(
    { search: debouncedSearch },
    { enabled: debouncedSearch.trim() !== '' },
  );

  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || prefillStudentIds === undefined || prefillStudentIds.length === 0) {
      return;
    }
    seededRef.current = true;
    setSelected(prefillStudentIds.slice(0, MAX_STUDENTS).map((id) => ({ id, full_name: '' })));
  }, [open, prefillStudentIds]);

  // Prefilled ids arrive with no name (the caller only has an id, e.g. the
  // student's Fines tab) — resolve each one's `full_name` so the chip
  // doesn't render a raw UUID.
  const prefilledNameQueries = useQueries({
    queries: (prefillStudentIds ?? []).map((id) => ({
      ...studentQueryOptions(id),
      enabled: open,
    })),
  });
  React.useEffect(() => {
    for (const query of prefilledNameQueries) {
      const student = query.data;
      if (student === undefined) continue;
      // `useQueries` returns a new array (and this effect's dependency) on every
      // render, so `setSelected` here must be a genuine no-op once every prefilled
      // name is resolved — `prev.map(...)` always returns a *new* array even when
      // no entry changes, which would otherwise re-trigger this effect forever.
      setSelected((prev) => {
        const needsUpdate = prev.some((s) => s.id === student.id && s.full_name === '');
        if (!needsUpdate) return prev;
        return prev.map((s) =>
          s.id === student.id && s.full_name === '' ? { ...s, full_name: student.full_name } : s,
        );
      });
    }
  }, [prefilledNameQueries]);

  const logFine = useLogFine();

  function addStudent(student: SelectedStudent) {
    if (selected.length >= MAX_STUDENTS) return;
    if (selected.some((existing) => existing.id === student.id)) return;
    setSelected((prev) => [...prev, student]);
    setSearch('');
  }

  function removeStudent(id: string) {
    setSelected((prev) => prev.filter((student) => student.id !== id));
  }

  function resetAndClose() {
    setSelected([]);
    setSearch('');
    setFeeStructureId('');
    setAmountMinorUnits(undefined);
    setAmountTouched(false);
    setNote('');
    setIncidentDate(todayDateInputValue());
    setNotifyFamilies(true);
    logFine.reset();
    onOpenChange(false);
  }

  const trimmedNote = note.trim();
  const noteInvalid = trimmedNote.length < REASON_MIN_LENGTH || note.length > REASON_MAX_LENGTH;
  const canSubmit =
    selected.length > 0 &&
    feeStructureId !== '' &&
    !noteInvalid &&
    incidentDate !== '' &&
    !logFine.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const notifyTenantId = captureNotificationTenant();
    logFine.mutate(
      {
        student_ids: selected.map((s) => s.id),
        fee_structure_id: feeStructureId,
        ...(amountMinorUnits !== undefined
          ? { amount: Number(minorUnitsToDecimalString(amountMinorUnits, config)) }
          : {}),
        note: trimmedNote,
        incident_date: incidentDate,
        notify_families: notifyFamilies,
      },
      {
        onSuccess: (result) => {
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'success',
            message: `${t('logForm.save')}: ${result.bill_ids.length}`,
          });
          resetAndClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('logForm.title')}</DialogTitle>
          <DialogDescription>{t('logForm.notePlaceholder')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('logForm.studentsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {selected.map((student) => (
                <span
                  key={student.id}
                  className="flex items-center gap-1 rounded-full border border-border bg-accent px-3 py-1 text-sm"
                >
                  {student.full_name || student.id}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    iconOnly
                    aria-label={`Remove ${student.full_name || student.id}`}
                    onClick={() => removeStudent(student.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              ))}
            </div>

            <Input
              aria-label={t('logForm.studentsLabel')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={selected.length >= MAX_STUDENTS}
            />
            {debouncedSearch.trim() !== '' && (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto" aria-live="polite">
                {searchQuery.data?.data.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-start text-sm hover:bg-accent"
                      onClick={() => addStudent({ id: result.id, full_name: result.full_name })}
                    >
                      {result.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('logForm.feeLabel')}</span>
            <Select value={feeStructureId} onValueChange={setFeeStructureId}>
              <SelectTrigger aria-label={t('logForm.feeLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fineTypes.map((structure) => (
                  <SelectItem key={structure.id} value={structure.id}>
                    {structure.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('logForm.amountLabel')}</span>
            <MoneyInput
              aria-label={t('logForm.amountLabel')}
              config={config}
              value={amountMinorUnits}
              onValueChange={(value) => {
                setAmountTouched(true);
                setAmountMinorUnits(value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-fine-note" className="text-sm font-medium">
              {t('logForm.noteLabel')}
            </label>
            <Textarea
              id="log-fine-note"
              placeholder={t('logForm.notePlaceholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-fine-incident-date" className="text-sm font-medium">
              {t('logForm.incidentDateLabel')}
            </label>
            <Input
              id="log-fine-incident-date"
              type="date"
              value={incidentDate}
              max={todayDateInputValue()}
              onChange={(event) => setIncidentDate(event.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              aria-label={t('logForm.notifyLabel')}
            />
            {t('logForm.notifyLabel')}
          </label>

          {logFine.error !== null && logFine.error !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {describeSubmitError(logFine.error, t)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={logFine.isPending}>
              {logFine.isPending ? t('logForm.saving') : t('logForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
