import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useLastReminders,
  useSendSingleReminder,
  useSingleReminderPreview,
  useStudent,
  useStudentFeeSummary,
  type ReminderPreview,
  type SendSingleReminderInput,
  type Student,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { BulkReminderWizard } from './-bulk/bulk-reminder-wizard';
import { RecipientList } from './-shared/recipient-list';
import { skipReasonKey } from './-shared/skip-reason';
import { SmsSegmentCounter } from './-shared/sms-segment-counter';
import { StudentSearch } from './-shared/student-search';
import {
  findUnsupportedPlaceholders,
  SUPPORTED_PLACEHOLDERS,
} from './-shared/template-placeholders';
import { splitTemplateParams, WhatsappTemplateFields } from './-shared/whatsapp-template-fields';

/**
 * `/communications/reminders` — [8.11.9]'s single-student fee reminder:
 * compose → **mandatory server preview** → send.
 *
 * The story's teeth live in the staleness guard here: Send is enabled
 * only while the inputs (student, selected guardians, template, channel
 * override, WhatsApp fields) exactly match what the last successful
 * preview was run against — any edit re-disables Send until the preview
 * is re-run. A sent SMS cannot be recalled, so "preview ran once, then
 * the template was edited" must not count as previewed.
 *
 * Gated on COMMUNICATION_BULK_SEND, not COMMUNICATION_SEND: the server's
 * reminder routes are `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` — a TEACHER
 * holds COMMUNICATION_SEND but would 403 on every request this page
 * makes. Same UX-gate-not-security-boundary framing as `/fees/generate`.
 */
/**
 * `mode=bulk` switches the page from the single-student form to
 * [8.11.9]'s bulk wizard — a search param rather than a second route so
 * the wizard's own `?step=` (`useWizardShellStep`'s contract) and the
 * mode both survive a refresh together.
 */
const remindersSearchSchema = z.object({
  mode: z.enum(['bulk']).optional().catch(undefined),
  step: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/reminders')({
  validateSearch: remindersSearchSchema,
  loader: () => loadRouteNamespaces('communications'),
  pendingComponent: FeeRemindersPending,
  component: FeeRemindersPage,
});

const OVERRIDE_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type OverrideMedium = (typeof OVERRIDE_MEDIUMS)[number];
/** Sentinel for "no override" — Radix `Select` cannot carry an empty
 * string value, so the default option needs a real one. */
const PREFERRED = 'PREFERRED';

// [8.14.17]: the permission check that used to live at the top of
// `FeeRemindersPage` (an `EmptyState` shown when the viewer lacked
// `COMMUNICATION_BULK_SEND`) is gone — `_staff.tsx`'s `RequirePermission`
// now refuses the whole route in place, keyed off the same permission
// (`route-permissions.ts`), before this component ever mounts.
function FeeRemindersPage() {
  const regionConfig = useTenantRegionConfig();
  const { mode } = Route.useSearch();

  // Money (the outstanding balance) and dates (last reminder) both render
  // through the tenant's own region settings — same reasoning as
  // `/payments/record`'s own provider wrap.
  return (
    <RegionConfigProvider value={regionConfig}>
      {mode === 'bulk' ? <BulkReminderWizard /> : <SingleReminderForm />}
    </RegionConfigProvider>
  );
}

function SingleReminderForm() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const navigate = useNavigate();

  const [studentId, setStudentId] = React.useState<string | null>(null);
  const [guardianIds, setGuardianIds] = React.useState<string[]>([]);
  const [template, setTemplate] = React.useState('');
  const [mediumOverride, setMediumOverride] = React.useState<string>(PREFERRED);
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');
  /** Fingerprint of the inputs the last *accepted* preview ran against,
   * paired with that preview's own response — one state so the guard and
   * the rendered recipients can never disagree. `preview.data` (React
   * Query's last-settled response) is deliberately not rendered: with two
   * previews in flight, a slow earlier response can settle *after* a
   * newer one and would then be shown against the newer fingerprint. */
  const [acceptedPreview, setAcceptedPreview] = React.useState<{
    fingerprint: string;
    result: ReminderPreview;
  } | null>(null);
  /** Monotonic id of the most recent preview request — a response from
   * any older request is discarded in its onSuccess. */
  const previewRequestRef = React.useRef(0);

  const studentQuery = useStudent(studentId ?? undefined);
  const feeSummary = useStudentFeeSummary(studentId ?? undefined);
  const lastReminders = useLastReminders(studentId === null ? [] : [studentId]);

  const preview = useSingleReminderPreview();
  const send = useSendSingleReminder();

  const student = studentQuery.data;

  // A freshly loaded student starts with every guardian selected — the
  // server's own default when `guardian_ids` is omitted, made visible.
  // Keyed by student *id*, not object identity: a background refetch (or
  // any cache update) hands back a new `student` object for the same
  // student, and re-running then would silently re-select guardians the
  // user had deliberately deselected.
  const guardianDefaultsForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (student !== undefined && guardianDefaultsForRef.current !== student.id) {
      guardianDefaultsForRef.current = student.id;
      setGuardianIds(student.guardians.map((guardian) => guardian.id));
    }
  }, [student]);

  const unsupportedTokens = findUnsupportedPlaceholders(template);

  /** The staleness guard's identity: every input the server preview
   * depends on, in a canonical order. */
  const fingerprint = JSON.stringify({
    studentId,
    guardianIds: [...guardianIds].sort(),
    template,
    mediumOverride,
    templateName,
    templateLanguage,
    templateParams,
  });

  const previewMatchesInputs =
    acceptedPreview !== null && acceptedPreview.fingerprint === fingerprint;

  const canPreview =
    studentId !== null &&
    template.trim() !== '' &&
    unsupportedTokens.length === 0 &&
    guardianIds.length > 0 &&
    !preview.isPending;

  const canSend =
    previewMatchesInputs &&
    (acceptedPreview?.result.recipients.length ?? 0) > 0 &&
    !send.isPending &&
    !send.isSuccess;

  // SMS limits only matter when an SMS can actually go out: an explicit
  // SMS override, or no override while a selected guardian prefers SMS.
  // An EMAIL/WHATSAPP-only send quoting "160 per segment" would be noise
  // (the send.tsx composer gates its counter the same way).
  const smsInPlay =
    mediumOverride === 'SMS' ||
    (mediumOverride === PREFERRED &&
      (student?.guardians.some(
        (guardian) =>
          guardianIds.includes(guardian.id) && guardian.preferred_communication === 'SMS',
      ) ??
        false));

  function buildInput(): SendSingleReminderInput {
    const params = splitTemplateParams(templateParams);
    return {
      message_template: template,
      guardian_ids: guardianIds,
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(mediumOverride !== PREFERRED ? { medium: mediumOverride as OverrideMedium } : {}),
      ...(mediumOverride === 'WHATSAPP' && templateName.trim() !== ''
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
    if (studentId === null) return;
    // Snapshot before the request: if the user edits while the preview is
    // in flight, the snapshot no longer equals the live fingerprint and
    // Send stays disabled — exactly the guard's job. The request id makes
    // the guard survive out-of-order responses too: a slow earlier
    // preview settling after a newer one must not overwrite the newer
    // preview's fingerprint or recipients.
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedFingerprint = fingerprint;
    preview.mutate(
      { studentId, input: buildInput() },
      {
        onSuccess: (result) => {
          if (previewRequestRef.current !== requestId) return;
          setAcceptedPreview({ fingerprint: requestedFingerprint, result });
        },
      },
    );
  }

  function handleSend() {
    if (studentId === null) return;
    send.mutate({ studentId, input: buildInput() });
  }

  function handleSelectStudent(selected: Student) {
    setStudentId(selected.id);
    // Invalidate any in-flight preview — its response belongs to the
    // previous student.
    previewRequestRef.current += 1;
    setAcceptedPreview(null);
    preview.reset();
    send.reset();
  }

  function handleChangeStudent() {
    setStudentId(null);
    setGuardianIds([]);
    // Clear the "defaults already applied for" marker too. Without this,
    // re-picking the *same* student leaves the ref matching their id, the
    // default-all effect never runs, and the guardian checklist stays empty
    // with Preview permanently disabled and nothing on screen explaining why.
    guardianDefaultsForRef.current = null;
    previewRequestRef.current += 1;
    setAcceptedPreview(null);
    preview.reset();
    send.reset();
  }

  function handleStartAnother() {
    handleChangeStudent();
    setTemplate('');
    setMediumOverride(PREFERRED);
    setTemplateName('');
    setTemplateLanguage('');
    setTemplateParams('');
  }

  function toggleGuardian(id: string) {
    setGuardianIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  function insertPlaceholder(token: string) {
    setTemplate((current) => (current === '' ? token : `${current} ${token}`));
  }

  const lastReminder = studentId === null ? undefined : lastReminders.data?.get(studentId);

  if (send.isSuccess) {
    const result = send.data;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">{t('reminders.title')}</h1>
        <section
          aria-label={t('reminders.resultTitle')}
          className="flex flex-col gap-4 rounded-md border border-border-subtle p-4"
        >
          <h2 className="text-lg font-medium">{t('reminders.resultTitle')}</h2>
          <div>
            <h3 className="text-sm font-semibold">
              {t('reminders.resultSentTitle', { count: result.sent.length })}
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {result.sent.map((entry) => (
                <li
                  key={entry.communication_log_id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {entry.guardian_name} · {t(`mediums.${entry.medium}`)}
                  </span>
                  <StatusBadge domain="communication" status={entry.status} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              {t('reminders.resultSkippedTitle', { count: result.skipped.length })}
            </h3>
            {result.skipped.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('recipientList.noneSkipped')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {result.skipped.map((entry) => {
                  const reasonKey = skipReasonKey(entry.reason);
                  return (
                    <li key={entry.guardian_id} className="text-sm">
                      {entry.guardian_name} —{' '}
                      {reasonKey !== undefined ? t(reasonKey) : entry.reason}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <Button type="button" onClick={handleStartAnother}>
              {t('reminders.changeStudent')}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{t('reminders.title')}</h1>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void navigate({ to: '/communications/reminders', search: { mode: 'bulk' } })
            }
          >
            {t('bulk.entryAction')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('reminders.description')}</p>
      </header>

      <section
        aria-label={t('reminders.studentSectionTitle')}
        className="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
      >
        <h2 className="text-sm font-medium">{t('reminders.studentSectionTitle')}</h2>
        {studentId === null ? (
          <StudentSearch
            inputId="reminder-student-search"
            searchLabel={t('reminders.studentSearchLabel')}
            searchPlaceholder={t('reminders.studentSearchPlaceholder')}
            noResultsLabel={t('reminders.studentNoResults')}
            onSelect={handleSelectStudent}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {student !== undefined
                  ? `${student.full_name} · ${student.registration_number}`
                  : '…'}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={handleChangeStudent}>
                {t('reminders.changeStudent')}
              </Button>
            </div>
            <dl className="grid gap-1 text-sm text-muted-foreground">
              {feeSummary.data !== undefined && (
                <div className="flex gap-2">
                  <dt>{t('reminders.balanceLabel')}:</dt>
                  {/* tabular-nums per design contract §2 — this balance is
                      re-rendered as the selected student changes, and
                      proportional figures make it jitter. Effective for Latin
                      digits (`en`); a no-op on Bengali numerals, whose face
                      ships no `tnum` — see §2's note. */}
                  <dd className="tabular-nums">
                    {formatServerAmount(feeSummary.data.summary.balance, config)}
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt>{t('reminders.lastReminderLabel')}:</dt>
                <dd>
                  {lastReminder === undefined
                    ? t('reminders.lastReminderNever')
                    : t('reminders.lastReminderValue', {
                        date: formatDate(new Date(lastReminder.sent_at), config),
                        medium: t(`mediums.${lastReminder.medium}`),
                      })}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {student !== undefined && studentId !== null && (
        <>
          <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
            <legend className="px-1 text-sm font-medium">{t('reminders.guardiansLabel')}</legend>
            {student.guardians.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {t('reminders.noGuardians')}
              </p>
            ) : (
              student.guardians.map((guardian) => {
                const optionLabel = t('reminders.guardianOptionLabel', {
                  name: guardian.full_name,
                  relationship: guardian.relationship,
                });
                return (
                  <span key={guardian.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`reminder-guardian-${guardian.id}`}
                      checked={guardianIds.includes(guardian.id)}
                      onCheckedChange={() => toggleGuardian(guardian.id)}
                    />
                    <label htmlFor={`reminder-guardian-${guardian.id}`}>
                      {optionLabel}{' '}
                      <span className="text-muted-foreground">
                        (
                        {t('reminders.guardianPrefers', {
                          medium: t(`mediums.${guardian.preferred_communication}`),
                        })}
                        )
                      </span>
                    </label>
                  </span>
                );
              })
            )}
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor="reminder-template">{t('reminders.messageLabel')}</Label>
            <Textarea
              id="reminder-template"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              rows={5}
            />
            {smsInPlay && (
              <>
                <SmsSegmentCounter text={template} />
                {/* The template is not what gets sent — placeholders
                    expand per student/guardian. The preview table shows
                    the real per-recipient counts; this one is only a
                    composing aid. */}
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

          <div className="grid gap-1.5">
            <Label htmlFor="reminder-medium-override">{t('reminders.mediumOverrideLabel')}</Label>
            <Select value={mediumOverride} onValueChange={setMediumOverride}>
              <SelectTrigger
                id="reminder-medium-override"
                aria-label={t('reminders.mediumOverrideLabel')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PREFERRED}>{t('reminders.mediumOverrideDefault')}</SelectItem>
                {OVERRIDE_MEDIUMS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`mediums.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mediumOverride === 'WHATSAPP' && (
            <WhatsappTemplateFields
              idPrefix="reminder"
              helperText={t('reminders.whatsappHelper')}
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
              templateLanguage={templateLanguage}
              onTemplateLanguageChange={setTemplateLanguage}
              templateParams={templateParams}
              onTemplateParamsChange={setTemplateParams}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview}
              loading={preview.isPending}
              onClick={handlePreview}
            >
              {preview.isPending ? t('reminders.previewing') : t('reminders.previewAction')}
            </Button>
            <Button type="button" disabled={!canSend} loading={send.isPending} onClick={handleSend}>
              {send.isPending ? t('reminders.sending') : t('reminders.sendAction')}
            </Button>
            {/* Why Send is disabled, in words: never previewed → the
                standing rule; previewed-then-edited → the staleness
                warning. */}
            {acceptedPreview !== null && !previewMatchesInputs ? (
              <p className="text-sm text-status-due-fg">{t('reminders.previewStale')}</p>
            ) : (
              !canSend && <p className="text-sm text-muted-foreground">{t('reminders.sendHint')}</p>
            )}
          </div>

          {preview.isError && (
            <p role="alert" className="text-sm text-destructive">
              {/* The server's 400s are specific and actionable ("No
                  deliverable guardian … every candidate skipped: …") —
                  surface them verbatim. */}
              {preview.error instanceof ApiError && preview.error.statusCode === 400
                ? preview.error.message
                : t('reminders.previewErrorMessage')}
            </p>
          )}
          {send.isError && (
            <p role="alert" className="text-sm text-destructive">
              {send.error instanceof ApiError && send.error.statusCode === 400
                ? send.error.message
                : t('reminders.errorMessage')}
            </p>
          )}

          {acceptedPreview !== null && previewMatchesInputs && (
            <section className="rounded-md border border-border-subtle p-3">
              <RecipientList
                recipients={acceptedPreview.result.recipients}
                skipped={acceptedPreview.result.skipped}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FeeRemindersPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
