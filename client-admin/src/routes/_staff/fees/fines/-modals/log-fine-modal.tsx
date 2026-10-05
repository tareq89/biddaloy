/**
 * [38.4.1] "Log fine" — one FINE-type fee structure charged to one or more
 * students at once. Shares the Fines page, a student's Fines tab, and the
 * command palette (per U7). Structurally cloned from
 * `client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx`
 * (student search + chips) — see the plan comment on #1119 for why that
 * file's path in the ticket body was wrong.
 */
import { FeeType } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DatePicker,
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
import { FullPageShell } from '@biddaloy/ui/shells';
import {
  minorUnitsToDecimalString,
  parseDate,
  serverAmountToMinorUnits,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CircleAlert, X } from 'lucide-react';
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

/** Never the server's text (D9) — always the translated sentence. */
function describeSubmitError(t: TFunction<'fines'>): string {
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
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

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

  function submit() {
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
            message: t('logForm.result', { count: result.bill_ids.length }),
          });
          resetAndClose();
        },
      },
    );
  }

  // A request in flight must not be abandoned by Esc / X / Cancel.
  function requestClose() {
    if (logFine.isPending) return;
    resetAndClose();
  }

  function requestCancel() {
    if (logFine.isPending) return;
    if (selected.length > 0 || note !== '') setConfirmDiscard(true);
    else resetAndClose();
  }

  if (!open) return null;

  const cardClass = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';

  return (
    <FullPageShell
      title={t('logForm.title')}
      onClose={requestClose}
      dirty={selected.length > 0 || note !== ''}
      primary={{
        label: logFine.isPending ? t('logForm.saving') : t('logForm.save'),
        onClick: submit,
        busy: logFine.isPending,
        disabled: !canSubmit,
      }}
      secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: requestCancel }}
    >
      <section aria-labelledby="log-fine-students" className={cardClass}>
        <h2 id="log-fine-students" className="text-h3">
          {t('logForm.studentsLabel')}
        </h2>
        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.map((student) => (
              <span
                key={student.id}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary ps-3 pe-1 text-label text-secondary-foreground"
              >
                {student.full_name || '—'}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  iconOnly
                  aria-label={t('logForm.removeStudent', { name: student.full_name || '—' })}
                  onClick={() => removeStudent(student.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="log-fine-search" className="text-label">
            {t('logForm.studentsLabel')}
          </label>
          <Input
            id="log-fine-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={selected.length >= MAX_STUDENTS}
          />
        </div>
        {debouncedSearch.trim() !== '' && (searchQuery.data?.data.length ?? 0) > 0 && (
          <ul
            className="mt-3 divide-y divide-border-subtle rounded-lg border border-border-subtle"
            aria-live="polite"
          >
            {searchQuery.data?.data.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-start hover:bg-muted"
                  onClick={() => addStudent({ id: result.id, full_name: result.full_name })}
                >
                  {result.full_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="log-fine-details" className={cardClass}>
        <h2 id="log-fine-details" className="text-h3">
          {t('logForm.detailsHeading')}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-fine-type" className="text-label">
              {t('logForm.feeLabel')}
            </label>
            <Select value={feeStructureId} onValueChange={setFeeStructureId}>
              <SelectTrigger id="log-fine-type">
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
            <label htmlFor="log-fine-amount" className="text-label">
              {t('logForm.amountLabel')}
            </label>
            <MoneyInput
              id="log-fine-amount"
              config={config}
              value={amountMinorUnits}
              onValueChange={(value) => {
                setAmountTouched(true);
                setAmountMinorUnits(value);
              }}
            />
            <p className="text-caption text-text-secondary">{t('logForm.amountHint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-fine-incident-date" className="text-label">
              {t('logForm.incidentDateLabel')}
            </label>
            <DatePicker
              id="log-fine-incident-date"
              aria-label={t('logForm.incidentDateLabel')}
              config={config}
              value={incidentDate === '' ? undefined : parseDate(incidentDate)}
              max={parseDate(todayDateInputValue())}
              onValueChange={(date) => setIncidentDate(date ? toIsoDate(date) : '')}
            />
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label htmlFor="log-fine-note" className="text-label">
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

          <label className="flex min-h-11 items-center gap-3 md:col-span-2 md:min-h-8">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
            />
            {t('logForm.notifyLabel')}
          </label>
        </div>
      </section>

      {logFine.error !== null && logFine.error !== undefined && (
        <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
          <CircleAlert className="size-4" aria-hidden="true" />
          {describeSubmitError(t)}
        </p>
      )}

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        tone="danger"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setConfirmDiscard(false);
          resetAndClose();
        }}
      />
    </FullPageShell>
  );
}
