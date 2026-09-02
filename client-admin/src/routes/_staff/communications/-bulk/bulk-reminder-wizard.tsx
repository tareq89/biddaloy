/**
 * [8.11.9]'s bulk fee-reminder wizard: Recipients (dues filters +
 * explicit selection, ≤500) → Message (named batch, template, channels)
 * → Review (mandatory server preview) → submit.
 *
 * Two rules carried over from the single-reminder page, because a sent
 * SMS cannot be recalled:
 *
 * 1. **Filters never define the recipient set** — `useFeeDues` only
 *    proposes rows; a student is included exactly when the sender ticked
 *    their checkbox. The running "N of 500" counter is that promise made
 *    visible.
 * 2. **Nothing sends until the server preview matches the current
 *    inputs.** The review step fingerprints every input the preview
 *    depends on; editing any earlier step changes the fingerprint,
 *    which disables submit until the preview is re-run. Client-side
 *    guessing can't reproduce the server's skip logic, so the preview
 *    is `POST /reminder/bulk/preview`, not a local computation.
 */
import { FeeStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  DataTable,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useBulkReminderPreview,
  useClasses,
  useClassSections,
  useFeeDues,
  useSendBulkReminder,
  type BulkReminderPreview,
  type FeeDueRow,
  type SendBulkReminderInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWizardShellStep, WizardShell, type WizardStep } from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { RecipientList } from '../-shared/recipient-list';
import { skipReasonKey } from '../-shared/skip-reason';
import { SmsSegmentCounter } from '../-shared/sms-segment-counter';
import {
  findUnsupportedPlaceholders,
  SUPPORTED_PLACEHOLDERS,
} from '../-shared/template-placeholders';
import { splitTemplateParams, WhatsappTemplateFields } from '../-shared/whatsapp-template-fields';

/** Mirror of the server's `MAX_BULK_REMINDER_STUDENTS` (`@ArrayMaxSize`
 * on `SendBulkReminderDto.student_ids`) — enforced here so the sender
 * learns about the cap while selecting, not from a 400. */
const MAX_STUDENTS = 500;

const STEP_IDS = ['recipients', 'message', 'review'] as const;

const BULK_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type BulkMedium = (typeof BULK_MEDIUMS)[number];

/** Radix `Select.Item` rejects empty-string `value` — same sentinel
 * convention `fees/dues.tsx` uses for its "All …" options. */
const ALL_VALUE = '__all__';

const PAGE_SIZE = 10;

interface RecipientFilters {
  classId?: string;
  sectionId?: string;
  month?: string;
  year?: string;
  status?: string;
}

export function BulkReminderWizard() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const navigate = useNavigate();

  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);

  // --- Recipients step state -------------------------------------------
  const [filters, setFilters] = React.useState<RecipientFilters>({});
  const [page, setPage] = React.useState(1);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  // --- Message step state ----------------------------------------------
  const [batchName, setBatchName] = React.useState('');
  const [template, setTemplate] = React.useState('');
  const [mediums, setMediums] = React.useState<ReadonlySet<BulkMedium>>(
    () => new Set<BulkMedium>(BULK_MEDIUMS),
  );
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');

  // --- Review step state (same guard shape as `reminders.tsx`) ---------
  const [acceptedPreview, setAcceptedPreview] = React.useState<{
    fingerprint: string;
    result: BulkReminderPreview;
  } | null>(null);
  const previewRequestRef = React.useRef(0);

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.classId);
  const duesQuery = useFeeDues({
    page,
    limit: PAGE_SIZE,
    ...(filters.classId !== undefined ? { class_id: filters.classId } : {}),
    ...(filters.sectionId !== undefined ? { section_id: filters.sectionId } : {}),
    ...(filters.month !== undefined ? { month: Number(filters.month) } : {}),
    ...(filters.year !== undefined ? { year: Number(filters.year) } : {}),
    ...(filters.status !== undefined
      ? { status: filters.status as FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID }
      : {}),
  });

  const preview = useBulkReminderPreview();
  const send = useSendBulkReminder();

  const unsupportedTokens = findUnsupportedPlaceholders(template);
  const selectedCount = selectedIds.size;

  /** Every input the server preview depends on, in canonical order —
   * mutating any earlier step changes this string, which invalidates the
   * review step until the preview is re-run against the new inputs. */
  const fingerprint = JSON.stringify({
    studentIds: Array.from(selectedIds).sort(),
    batchName,
    template,
    mediums: Array.from(mediums).sort(),
    templateName,
    templateLanguage,
    templateParams,
  });

  const previewMatchesInputs =
    acceptedPreview !== null && acceptedPreview.fingerprint === fingerprint;

  function buildInput(): SendBulkReminderInput {
    const params = splitTemplateParams(templateParams);
    return {
      student_ids: Array.from(selectedIds).sort(),
      message_template: template,
      batch_name: batchName.trim(),
      mediums: Array.from(mediums).sort(),
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(mediums.has('WHATSAPP') && templateName.trim() !== ''
        ? {
            whatsapp_template_name: templateName.trim(),
            ...(templateLanguage.trim() !== ''
              ? { whatsapp_template_language: templateLanguage.trim() }
              : {}),
            ...(params.length > 0 ? { whatsapp_template_params: params } : {}),
          }
        : {}),
    };
  }

  function handlePreview() {
    // Snapshot before the request, and discard out-of-order responses —
    // same reasoning as the single-reminder page's own handler.
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedFingerprint = fingerprint;
    preview.mutate(buildInput(), {
      onSuccess: (result) => {
        if (previewRequestRef.current !== requestId) return;
        setAcceptedPreview({ fingerprint: requestedFingerprint, result });
      },
    });
  }

  function handleSubmit() {
    if (!previewMatchesInputs) return;
    send.mutate(buildInput());
  }

  /** 400s verbatim (specific and actionable), 429 as the rate-limit note
   * (`POST /reminder/bulk*` is STRICT_RATE_LIMIT 5/min), anything else
   * generic. */
  function requestErrorMessage(error: unknown, fallbackKey: string): string {
    if (error instanceof ApiError && error.statusCode === 400) return error.message;
    if (error instanceof ApiError && error.statusCode === 429) return t('bulk.review.rateLimited');
    return t(fallbackKey);
  }

  function setFilter(key: keyof RecipientFilters, value: string | undefined) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (value === undefined) delete next[key];
      // A class change invalidates any picked section, same dependency
      // `fees/dues.tsx` enforces.
      if (key === 'classId') delete next.sectionId;
      return next;
    });
    setPage(1);
  }

  function toggleMedium(medium: BulkMedium) {
    setMediums((current) => {
      const next = new Set(current);
      if (next.has(medium)) next.delete(medium);
      else next.add(medium);
      return next;
    });
  }

  function insertPlaceholder(token: string) {
    setTemplate((current) => (current === '' ? token : `${current} ${token}`));
  }

  const monthOptions = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
    [],
  );
  const currentYear = new Date().getFullYear();
  const yearOptions = React.useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(String),
    [currentYear],
  );

  const dueRows = duesQuery.data?.data ?? [];
  const columns: DataTableColumn<FeeDueRow>[] = [
    {
      id: 'student',
      header: t('bulk.recipients.nameHeader'),
      accessorFn: (row) => `${row.full_name} (${row.registration_number})`,
    },
    {
      id: 'class',
      header: t('bulk.recipients.classHeader'),
      accessorFn: (row) => row.class_name ?? '—',
    },
    {
      id: 'section',
      header: t('bulk.recipients.sectionHeader'),
      accessorFn: (row) => row.section_name ?? '—',
    },
    {
      id: 'due',
      header: t('bulk.recipients.dueHeader'),
      // tabular-nums: money columns align on the decimal (design contract §2).
      // Effective for Latin digits (`en`); a no-op on Bengali numerals, whose
      // face ships no `tnum` — see §2's note.
      accessorFn: (row) => (
        <span className="tabular-nums">{formatServerAmount(row.total_due, config)}</span>
      ),
    },
    {
      id: 'monthsOverdue',
      header: t('bulk.recipients.monthsOverdueHeader'),
      accessorFn: (row) => String(row.months_overdue),
    },
  ];

  const recipientsStep: WizardStep = {
    id: 'recipients',
    label: t('bulk.steps.recipients'),
    isValid: () => selectedCount >= 1 && selectedCount <= MAX_STUDENTS,
    content: (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <FilterSelect
            id="bulk-filter-class"
            label={t('bulk.recipients.filterClass')}
            value={filters.classId}
            onChange={(value) => setFilter('classId', value)}
            options={(classesQuery.data?.data ?? []).map((cls) => ({
              value: cls.id,
              label: cls.name,
            }))}
            allLabel={t('bulk.recipients.allOption')}
          />
          <FilterSelect
            id="bulk-filter-section"
            label={t('bulk.recipients.filterSection')}
            value={filters.sectionId}
            onChange={(value) => setFilter('sectionId', value)}
            options={(sectionsQuery.data ?? []).map((section) => ({
              value: section.id,
              label: section.section_name,
            }))}
            allLabel={t('bulk.recipients.allOption')}
          />
          <FilterSelect
            id="bulk-filter-month"
            label={t('bulk.recipients.filterMonth')}
            value={filters.month}
            onChange={(value) => setFilter('month', value)}
            options={monthOptions.map((month) => ({ value: String(Number(month)), label: month }))}
            allLabel={t('bulk.recipients.allOption')}
          />
          <FilterSelect
            id="bulk-filter-year"
            label={t('bulk.recipients.filterYear')}
            value={filters.year}
            onChange={(value) => setFilter('year', value)}
            options={yearOptions.map((year) => ({ value: year, label: year }))}
            allLabel={t('bulk.recipients.allOption')}
          />
          <FilterSelect
            id="bulk-filter-status"
            label={t('bulk.recipients.filterStatus')}
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={[
              { value: FeeStatus.PENDING, label: t('bulk.recipients.statusPending') },
              {
                value: FeeStatus.PARTIALLY_PAID,
                label: t('bulk.recipients.statusPartiallyPaid'),
              },
            ]}
            allLabel={t('bulk.recipients.allOption')}
          />
        </div>

        {/* The AC's "explicit selection" counter — announced politely so
            a keyboard/screen-reader user always knows the running total
            without leaving the table. */}
        <p aria-live="polite" className="text-sm font-medium">
          {t('bulk.recipients.selectedCount', { count: selectedCount, max: MAX_STUDENTS })}
        </p>
        {selectedCount > MAX_STUDENTS && (
          <p role="alert" className="text-sm text-destructive">
            {t('bulk.recipients.overCap', {
              max: MAX_STUDENTS,
              excess: selectedCount - MAX_STUDENTS,
            })}
          </p>
        )}

        <DataTable
          tableId="bulk-reminder-recipients"
          caption={t('bulk.recipients.tableCaption')}
          columns={columns}
          data={dueRows}
          getRowId={(row) => row.student_id}
          sorting={null}
          onSortingChange={() => undefined}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={duesQuery.data?.total ?? 0}
          onPageChange={setPage}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          loading={duesQuery.isPending}
          isFetching={duesQuery.isFetching}
          {...(duesQuery.isError ? { error: t('bulk.recipients.loadError') } : {})}
          emptyMessage={t('bulk.recipients.empty')}
        />
      </div>
    ),
  };

  const smsInPlay = mediums.has('SMS');

  const messageStep: WizardStep = {
    id: 'message',
    label: t('bulk.steps.message'),
    isValid: () =>
      batchName.trim() !== '' &&
      template.trim() !== '' &&
      unsupportedTokens.length === 0 &&
      mediums.size >= 1,
    content: (
      <div className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-batch-name">{t('bulk.message.batchNameLabel')}</Label>
          <Input
            id="bulk-batch-name"
            value={batchName}
            onChange={(event) => setBatchName(event.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="bulk-template">{t('bulk.message.messageLabel')}</Label>
          <Textarea
            id="bulk-template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            rows={5}
          />
          {smsInPlay && (
            <>
              <SmsSegmentCounter text={template} />
              <p className="text-xs text-muted-foreground">{t('reminders.smsEstimateNote')}</p>
            </>
          )}
          <div
            role="group"
            aria-label={t('reminders.placeholdersLabel')}
            className="flex flex-wrap gap-1.5"
          >
            {SUPPORTED_PLACEHOLDERS.map((token) => (
              <Button
                key={token}
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('reminders.insertPlaceholder', { token })}
                onClick={() => insertPlaceholder(token)}
              >
                {token}
              </Button>
            ))}
          </div>
          {unsupportedTokens.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {t('reminders.unknownPlaceholder', {
                token: unsupportedTokens.join(', '),
                supported: SUPPORTED_PLACEHOLDERS.join(', '),
              })}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
          <legend className="px-1 text-sm font-medium">{t('bulk.message.mediumsLabel')}</legend>
          {BULK_MEDIUMS.map((medium) => (
            <span key={medium} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`bulk-medium-${medium}`}
                checked={mediums.has(medium)}
                onCheckedChange={() => toggleMedium(medium)}
              />
              <label htmlFor={`bulk-medium-${medium}`}>{t(`mediums.${medium}`)}</label>
            </span>
          ))}
        </fieldset>

        {mediums.has('WHATSAPP') && (
          <WhatsappTemplateFields
            idPrefix="bulk"
            helperText={t('reminders.whatsappHelper')}
            templateName={templateName}
            onTemplateNameChange={setTemplateName}
            templateLanguage={templateLanguage}
            onTemplateLanguageChange={setTemplateLanguage}
            templateParams={templateParams}
            onTemplateParamsChange={setTemplateParams}
          />
        )}
      </div>
    ),
  };

  const previewResult = previewMatchesInputs ? acceptedPreview.result : null;

  // Student-level and guardian-level skips flattened into one
  // reason-grouped view — "7 students skipped" alone would hide *why*.
  const skippedByReason = new Map<string, number>();
  if (previewResult !== null) {
    for (const student of previewResult.students) {
      for (const entry of student.skipped) {
        skippedByReason.set(entry.reason, (skippedByReason.get(entry.reason) ?? 0) + 1);
      }
    }
  }

  const reviewStep: WizardStep = {
    id: 'review',
    label: t('bulk.steps.review'),
    isValid: () =>
      previewMatchesInputs && (previewResult?.recipients_count ?? 0) > 0 && !send.isPending,
    content: (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={preview.isPending}
            loading={preview.isPending}
            onClick={handlePreview}
          >
            {preview.isPending ? t('bulk.review.previewing') : t('bulk.review.previewAction')}
          </Button>
          {/* Why submit is disabled, in words — never previewed vs.
              previewed-then-edited, same split as the single page. */}
          {acceptedPreview !== null && !previewMatchesInputs ? (
            <p className="text-sm text-status-due-fg">{t('bulk.review.stale')}</p>
          ) : (
            acceptedPreview === null && (
              <p className="text-sm text-muted-foreground">{t('bulk.review.notPreviewedHint')}</p>
            )
          )}
        </div>

        {preview.isError && (
          <p role="alert" className="text-sm text-destructive">
            {requestErrorMessage(preview.error, 'bulk.review.previewErrorMessage')}
          </p>
        )}

        {previewResult !== null && (
          <section
            aria-label={t('bulk.steps.review')}
            className="flex flex-col gap-4 rounded-md border border-border-subtle p-3"
          >
            <p className="text-sm font-medium">
              {t('bulk.review.summary', {
                recipients: previewResult.recipients_count,
                skipped: previewResult.skipped_count,
              })}
            </p>
            {previewResult.recipients_count === 0 && (
              <p role="alert" className="text-sm text-destructive">
                {t('bulk.review.noRecipients')}
              </p>
            )}

            {skippedByReason.size > 0 && (
              <div>
                <h2 className="text-sm font-semibold">{t('bulk.review.skippedByReasonTitle')}</h2>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {Array.from(skippedByReason.entries()).map(([reason, count]) => {
                    const reasonKey = skipReasonKey(reason);
                    return (
                      <li key={reason}>
                        {reasonKey !== undefined ? t(reasonKey) : reason} —{' '}
                        {t('bulk.review.reasonCount', { count: count })}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div>
              <h2 className="text-sm font-semibold">{t('bulk.review.perStudentTitle')}</h2>
              <div className="mt-2 flex flex-col gap-2">
                {previewResult.students.map((student) => (
                  <details
                    key={student.student_id}
                    className="rounded-md border border-border-subtle p-2"
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      {student.student_name} ·{' '}
                      {t('bulk.review.studentRecipients', { count: student.recipients.length })} ·{' '}
                      {t('bulk.review.studentSkipped', { count: student.skipped.length })}
                    </summary>
                    <div className="mt-2">
                      <RecipientList recipients={student.recipients} skipped={student.skipped} />
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {send.isError && (
          <p role="alert" className="text-sm text-destructive">
            {requestErrorMessage(send.error, 'bulk.review.sendErrorMessage')}
          </p>
        )}
      </div>
    ),
  };

  const result = send.isSuccess ? (
    <section
      aria-label={t('bulk.result.title')}
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-4"
    >
      <h2 className="text-lg font-medium">{t('bulk.result.title')}</h2>
      <p className="text-sm">{t('bulk.result.queued', { name: send.data.batch_name })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/communications/batches/$batchId"
          params={{ batchId: send.data.id }}
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {t('bulk.result.viewBatch')}
        </Link>
      </div>
    </section>
  ) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigate({ to: '/communications/reminders', search: { mode: undefined } })
          }
        >
          {t('bulk.backToSingle')}
        </Button>
      </div>
      <WizardShell
        title={t('bulk.title')}
        steps={[recipientsStep, messageStep]}
        reviewStep={reviewStep}
        irreversible
        currentStepId={stepId}
        onStepChange={setStepId}
        onSubmit={handleSubmit}
        submitLabel={t('bulk.submitLabel')}
        submitting={send.isPending}
        {...(result !== undefined ? { result } : {})}
      />
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ALL_VALUE}
        onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
      >
        <SelectTrigger id={id} aria-label={label} className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
