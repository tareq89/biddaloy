/**
 * [38.4.1] "Generate fines" — sweeps one month's attendance and writes fines
 * from every active fine rule. Cloned structurally from
 * `client-admin/src/routes/_staff/fees/-generate/generate-fees-modal.tsx`;
 * duplicate handling reuses that file's `duplicates-step.tsx` shape (SKIP /
 * REMOVE_OLDER / CREATE_ANYWAY, the last one approval-gated).
 *
 * The preview response (`FineSweepPreviewResultDto`) carries only
 * `student_id`, not a name — this modal resolves display names itself via
 * `useStudentSearch` over the same class/section scope, same trick
 * `generate-fees-modal.tsx` uses for fee-structure names. See the plan
 * comment on #1119.
 */
import { FeeType } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  MonthPicker,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  useAcademicYears,
  useClasses,
  useClassSections,
  useFeeStructures,
  useGenerateFines,
  usePreviewFineGeneration,
  useStudentSearch,
  type FineSweepGenerateInput,
  type FineSweepPreviewResult,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatCurrency, formatNumber, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import { CalendarCheck2, CircleAlert, TriangleAlert } from 'lucide-react';
import * as React from 'react';

const ALL_VALUE = '__all__';
const CREATE_LOCK_MS = 600;

function previousMonthValue(): string {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

/** Never the server's text (D9) — always the translated sentence. */
function describeSubmitError(t: TFunction<'fines'>): string {
  return t('generate.errorMessage');
}

export interface GenerateFinesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: { classId?: string; sectionId?: string };
}

export function GenerateFinesModal({ open, onOpenChange, prefill }: GenerateFinesModalProps) {
  const { t } = useTranslation('fines');
  const config = useRegionConfig();

  const [month, setMonth] = React.useState(previousMonthValue());
  const [classId, setClassId] = React.useState(prefill?.classId ?? ALL_VALUE);
  // A section only makes sense with its class — ignore a `sectionId`
  // prefill given without a `classId` rather than seeding a section the
  // (empty) section list for "All classes" can never contain.
  const [sectionId, setSectionId] = React.useState(
    prefill?.classId !== undefined ? (prefill.sectionId ?? ALL_VALUE) : ALL_VALUE,
  );
  const [notifyFamilies, setNotifyFamilies] = React.useState(true);
  const [duplicateAction, setDuplicateAction] = React.useState<
    'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY'
  >('SKIP');
  const [preview, setPreview] = React.useState<FineSweepPreviewResult | null>(null);
  const [previewScopeKey, setPreviewScopeKey] = React.useState<string | null>(null);

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId !== ALL_VALUE ? classId : undefined);

  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  // The primary changes from "See what will be made" to "Generate fines" in the
  // same spot; a double-click must not create fines before the preview is read.
  const [createLocked, setCreateLocked] = React.useState(false);
  const lockTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewHeadingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => () => clearTimeout(lockTimer.current), []);

  const previewMutation = usePreviewFineGeneration();
  const generate = useGenerateFines();

  // Resolves student names for the preview table — same scope the preview
  // itself ran against.
  const studentsQuery = useStudentSearch(
    {
      ...(classId !== ALL_VALUE ? { class_id: classId } : {}),
      ...(sectionId !== ALL_VALUE ? { section_id: sectionId } : {}),
      limit: 200,
    },
    { enabled: preview !== null },
  );
  // Scope the name lookup to the month's academic year so the 100-row page is
  // not eaten by other years' fine types.
  const yearsQuery = useAcademicYears();
  const monthYearId = (yearsQuery.data?.data ?? []).find(
    (year) => year.start_date.slice(0, 7) <= month && month <= year.end_date.slice(0, 7),
  )?.id;
  const fineTypesQuery = useFeeStructures({
    fee_type: FeeType.FINE,
    limit: 100,
    ...(monthYearId !== undefined ? { academic_year_id: monthYearId } : {}),
  });
  const fineTypes = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const structure of fineTypesQuery.data?.data ?? []) map.set(structure.id, structure.name);
    return map;
  }, [fineTypesQuery.data]);
  const studentNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const student of studentsQuery.data?.data ?? []) map.set(student.id, student.full_name);
    return map;
  }, [studentsQuery.data]);

  function scope() {
    return {
      month,
      ...(classId !== ALL_VALUE ? { class_id: classId } : {}),
      ...(sectionId !== ALL_VALUE ? { section_id: sectionId } : {}),
    };
  }

  function scopeKey() {
    return JSON.stringify(scope());
  }

  const canSubmit = month !== '' && !previewMutation.isPending && !generate.isPending;

  function resetAndClose() {
    setPreview(null);
    setPreviewScopeKey(null);
    setDuplicateAction('SKIP');
    generate.reset();
    previewMutation.reset();
    onOpenChange(false);
  }

  function submitGenerate(action: 'SKIP' | 'REMOVE_OLDER' | 'CREATE_ANYWAY') {
    const notifyTenantId = captureNotificationTenant();
    const input: FineSweepGenerateInput = {
      ...scope(),
      duplicate_strategy: action,
      notify_families: notifyFamilies,
    };
    generate.mutate(input, {
      onSuccess: (result) => {
        notifyOutcome({
          tenantId: notifyTenantId,
          variant: 'success',
          message: t('generate.result.generated_other', { count: result.generated_count }),
        });
        resetAndClose();
      },
      onError: (error) => {
        if (error instanceof ApprovalCancelledError) return;
        notifyOutcome({
          tenantId: notifyTenantId,
          variant: 'error',
          message: t('generate.errorMessage'),
        });
      },
    });
  }

  const hasCurrentPreview = preview !== null && previewScopeKey === scopeKey();
  const previewIsZero =
    hasCurrentPreview && preview.would_create === 0 && preview.duplicates.length === 0;
  const busy = previewMutation.isPending || generate.isPending;

  function handleSubmit() {
    if (!canSubmit) return;

    const currentScopeKey = scopeKey();
    if (preview !== null && previewScopeKey === currentScopeKey) {
      submitGenerate(duplicateAction);
      return;
    }

    // Always stop at the preview: the accountant sees what will be created
    // before anything is written.
    previewMutation.mutate(scope(), {
      onSuccess: (result) => {
        setPreview(result);
        setPreviewScopeKey(currentScopeKey);
        setCreateLocked(true);
        clearTimeout(lockTimer.current);
        lockTimer.current = setTimeout(() => setCreateLocked(false), CREATE_LOCK_MS);
      },
    });
  }

  // A request in flight must not be abandoned by Esc / X / Cancel.
  function requestClose() {
    if (busy) return;
    resetAndClose();
  }

  function requestCancel() {
    if (busy) return;
    if (preview !== null) setConfirmDiscard(true);
    else resetAndClose();
  }

  const distinctStudentCount = preview
    ? new Set(preview.students.map((row) => row.student_id)).size
    : 0;
  const submitError = generate.error ?? previewMutation.error;

  React.useEffect(() => {
    if (hasCurrentPreview && !previewIsZero) previewHeadingRef.current?.focus();
  }, [hasCurrentPreview, previewIsZero]);

  if (!open) return null;

  const duplicateOptions = [
    {
      value: 'SKIP',
      label: t('generate.duplicates.skipLabel'),
      hint: t('generate.duplicates.skipHint'),
    },
    {
      value: 'REMOVE_OLDER',
      label: t('generate.duplicates.removeOlderLabel'),
      hint: t('generate.duplicates.removeOlderHint'),
    },
    {
      value: 'CREATE_ANYWAY',
      label: t('generate.duplicates.createAnywayLabel'),
      hint: t('generate.duplicates.createAnywayHint'),
    },
  ] as const;

  return (
    <FullPageShell
      title={t('generate.title')}
      onClose={requestClose}
      size="wide"
      dirty={preview !== null && !busy}
      primary={{
        label: hasCurrentPreview ? t('generate.submitAction') : t('generate.previewAction'),
        onClick: handleSubmit,
        busy,
        disabled: !canSubmit || previewIsZero || (hasCurrentPreview && createLocked),
      }}
      secondary={{ label: t('actions.cancel', { ns: 'common' }), onClick: requestCancel }}
    >
      <section
        aria-labelledby="gen-scope"
        className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
      >
        <h2 id="gen-scope" className="text-h3">
          {t('generate.scopeHeading')}
        </h2>
        <p className="mt-1 text-text-secondary">{t('generate.description')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="generate-fines-month" className="text-label">
              {t('generate.monthLabel')}
            </label>
            <MonthPicker
              id="generate-fines-month"
              aria-label={t('generate.monthLabel')}
              value={month}
              onValueChange={(value) => {
                setMonth(value);
                setPreview(null);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="generate-fines-class" className="text-label">
              {t('generate.classLabel')}
            </label>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                setSectionId(ALL_VALUE);
                setPreview(null);
              }}
            >
              <SelectTrigger id="generate-fines-class">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('generate.allClasses')}</SelectItem>
                {(classesQuery.data?.data ?? []).map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="generate-fines-section" className="text-label">
              {t('generate.sectionLabel')}
            </label>
            <Select
              value={sectionId}
              onValueChange={(value) => {
                setSectionId(value);
                setPreview(null);
              }}
            >
              <SelectTrigger id="generate-fines-section" disabled={classId === ALL_VALUE}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('generate.allSections')}</SelectItem>
                {(sectionsQuery.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.section_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex min-h-11 items-center gap-3 md:col-span-3 md:min-h-8">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
            />
            {t('generate.notifyLabel')}
          </label>
        </div>
      </section>

      {hasCurrentPreview &&
        (previewIsZero ? (
          <EmptyState
            icon={<CalendarCheck2 />}
            title={t('generate.previewZero')}
            explanation={t('generate.previewZeroHint')}
          />
        ) : (
          <section aria-labelledby="gen-preview" className="space-y-3">
            <div>
              <h2
                id="gen-preview"
                ref={previewHeadingRef}
                tabIndex={-1}
                className="text-h3 outline-none"
              >
                {t('generate.previewHeading')}
              </h2>
              <p className="mt-0.5 text-text-secondary">
                {t('generate.previewLine', {
                  count: distinctStudentCount,
                  n: formatNumber(distinctStudentCount, config),
                  total: formatCurrency(
                    serverAmountToMinorUnits(preview.total_amount, config),
                    config,
                  ),
                })}
              </p>
            </div>
            <div data-testid="fine-preview-rows">
              <DataTable
                tableId="fine-preview"
                caption={t('generate.previewHeading')}
                paginated={false}
                data={preview.students}
                getRowId={(row) => `${row.student_id}-${row.rule_id}`}
                sorting={null}
                onSortingChange={() => {}}
                totalCount={preview.students.length}
                columns={[
                  {
                    id: 'student',
                    header: t('generate.columnStudent'),
                    accessorFn: (row) => studentNames.get(row.student_id) ?? '—',
                    card: 'title',
                  },
                  {
                    id: 'fine',
                    header: t('generate.columnFine'),
                    accessorFn: (row) => fineTypes.get(row.fee_structure_id) ?? '—',
                    card: 'subtitle',
                  },
                  {
                    id: 'count',
                    header: t('generate.columnCount'),
                    accessorFn: (row) =>
                      t('generate.countTimes', {
                        count: row.count,
                        n: formatNumber(row.count, config),
                      }),
                    align: 'end',
                  },
                  {
                    id: 'amount',
                    header: t('generate.columnAmount'),
                    accessorFn: (row) =>
                      formatCurrency(serverAmountToMinorUnits(row.amount, config), config),
                    align: 'end',
                  },
                ]}
              />
            </div>
          </section>
        ))}

      {hasCurrentPreview && preview.duplicates.length > 0 && (
        <section
          aria-labelledby="gen-duplicates"
          className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
        >
          <h2 id="gen-duplicates" className="flex items-center gap-2 text-h3">
            <TriangleAlert className="text-status-due-fg" aria-hidden="true" />
            {t('generate.duplicates.heading')}
          </h2>
          <RadioGroup
            value={duplicateAction}
            onValueChange={(value) => setDuplicateAction(value as typeof duplicateAction)}
            aria-labelledby="gen-duplicates"
            className="mt-2 flex flex-col"
          >
            {duplicateOptions.map((option) => (
              <label
                key={option.value}
                htmlFor={`gen-dup-${option.value}`}
                className="flex min-h-11 items-start gap-3 py-2"
              >
                <RadioGroupItem id={`gen-dup-${option.value}`} value={option.value} />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-caption text-text-secondary">{option.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </section>
      )}

      {submitError !== null && submitError !== undefined && (
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
