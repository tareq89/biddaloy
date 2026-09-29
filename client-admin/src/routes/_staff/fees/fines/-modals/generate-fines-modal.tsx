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
  useClasses,
  useClassSections,
  useGenerateFines,
  usePreviewFineGeneration,
  useStudentSearch,
  type FineSweepGenerateInput,
  type FineSweepPreviewResult,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import * as React from 'react';

const ALL_VALUE = '__all__';

function previousMonthValue(): string {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

function describeSubmitError(error: unknown, t: TFunction<'fines'>): string {
  if (error instanceof RateLimitedError) return t('generate.errorMessage');
  if (error instanceof ApiError) return error.message;
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const currentScopeKey = scopeKey();
    if (preview !== null && previewScopeKey === currentScopeKey) {
      submitGenerate(duplicateAction);
      return;
    }

    previewMutation.mutate(scope(), {
      onSuccess: (result) => {
        setPreview(result);
        setPreviewScopeKey(currentScopeKey);
        // Nothing to review — skip straight to the real submit. A zero
        // preview has nothing to duplicate-check either, so it always
        // stops here for the accountant to see "no fines" and re-pick a
        // scope, rather than silently no-op generating.
        if (result.duplicates.length === 0 && result.would_create > 0) submitGenerate('SKIP');
      },
    });
  }

  const distinctStudentCount = preview
    ? new Set(preview.students.map((row) => row.student_id)).size
    : 0;
  const submitError = generate.error ?? previewMutation.error;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('generate.title')}</DialogTitle>
          <DialogDescription>{t('generate.description')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="generate-fines-month" className="text-sm font-medium">
              {t('generate.monthLabel')}
            </label>
            <Input
              id="generate-fines-month"
              type="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setPreview(null);
              }}
            />
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('generate.classLabel')}</span>
              <Select
                value={classId}
                onValueChange={(value) => {
                  setClassId(value);
                  setSectionId(ALL_VALUE);
                  setPreview(null);
                }}
              >
                <SelectTrigger aria-label={t('generate.classLabel')}>
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

            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('generate.sectionLabel')}</span>
              <Select
                value={sectionId}
                onValueChange={(value) => {
                  setSectionId(value);
                  setPreview(null);
                }}
              >
                <SelectTrigger
                  aria-label={t('generate.sectionLabel')}
                  disabled={classId === ALL_VALUE}
                >
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
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              aria-label={t('generate.notifyLabel')}
            />
            {t('generate.notifyLabel')}
          </label>

          {preview !== null &&
            (preview.would_create === 0 ? (
              <p className="text-sm text-muted-foreground">{t('generate.previewZero')}</p>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
                <p className="text-sm font-medium">
                  {t('generate.previewLine', {
                    count: distinctStudentCount,
                    total: formatCurrency(
                      serverAmountToMinorUnits(preview.total_amount, config),
                      config,
                    ),
                  })}
                </p>
                <ul
                  className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm"
                  data-testid="fine-preview-rows"
                >
                  {preview.students.map((row) => (
                    <li
                      key={`${row.student_id}-${row.rule_id}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>{studentNames.get(row.student_id) ?? row.student_id}</span>
                      <span className="text-muted-foreground">
                        {row.count} ×{' '}
                        {formatCurrency(serverAmountToMinorUnits(row.amount, config), config)}
                      </span>
                    </li>
                  ))}
                </ul>

                {preview.duplicates.length > 0 && (
                  <RadioGroup
                    value={duplicateAction}
                    onValueChange={(value) => setDuplicateAction(value as typeof duplicateAction)}
                    aria-label={t('generate.duplicates.heading')}
                    className="flex flex-col gap-2"
                  >
                    <h3 className="text-sm font-medium">{t('generate.duplicates.heading')}</h3>
                    <label className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value="SKIP" />
                      <span>
                        <span className="font-medium">{t('generate.duplicates.skipLabel')}</span>{' '}
                        <span className="text-muted-foreground">
                          {t('generate.duplicates.skipHint')}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value="REMOVE_OLDER" />
                      <span>
                        <span className="font-medium">
                          {t('generate.duplicates.removeOlderLabel')}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {t('generate.duplicates.removeOlderHint')}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value="CREATE_ANYWAY" />
                      <span>
                        <span className="font-medium">
                          {t('generate.duplicates.createAnywayLabel')}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {t('generate.duplicates.createAnywayHint')}
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                )}
              </div>
            ))}

          {submitError !== null && submitError !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {describeSubmitError(submitError, t)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              disabled={
                !canSubmit ||
                (preview !== null && preview.would_create === 0 && preview.duplicates.length === 0)
              }
              loading={previewMutation.isPending || generate.isPending}
            >
              {t('generate.submitAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
