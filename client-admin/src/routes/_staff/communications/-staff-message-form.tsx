/**
 * [80.2.02] The "Message staff" form: who gets it, medium, message, a check step, send.
 * Nothing sends before the sender has seen the check (people, phones, credits) and confirmed.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  Checkbox,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  MultiCombobox,
  NoticeBar,
  RadioGroup,
  RadioGroupItem,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  type MultiComboboxOption,
} from '@biddaloy/ui/components';
import {
  designationTitle,
  useDebouncedValue,
  useDesignations,
  useSendStaffMessage,
  useStaffMessagePreview,
  useUsers,
  userQueryOptions,
  type StaffAudienceInput,
  type StaffMessageInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlertIcon, SendIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { SmsSegmentCounter } from './-shared/sms-segment-counter';
import { splitTemplateParams, WhatsappTemplateFields } from './-shared/whatsapp-template-fields';

type Role = NonNullable<StaffAudienceInput['roles']>[number];
const ROLES: readonly Role[] = [
  'ADMIN',
  'EXECUTIVE',
  'TEACHER',
  'ACCOUNTANT',
  'OFFICE_STAFF',
  'EXAM_CONTROLLER',
  'COMMITTEE',
];
/** Names looked up for a `?people=` prefill; the rest still get the message, only unnamed. */
const PREFILL_NAMES_MAX = 20;

/** The "Guardians | Staff" switch shown at the top of both send pages (D27). */
export function SendAudienceSwitch({
  value,
  onChange,
}: {
  value: 'guardians' | 'staff';
  onChange: (next: 'guardians' | 'staff') => void;
}) {
  const { t } = useTranslation('communications');
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as 'guardians' | 'staff')}>
      <TabsList aria-label={t('staffMessage.switch.label')}>
        <TabsTrigger value="guardians">{t('staffMessage.switch.guardians')}</TabsTrigger>
        <TabsTrigger value="staff">{t('staffMessage.switch.staff')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/**
 * Server answers are English sentences; map by status and body to our own words, never echo them.
 * ponytail: the 400 split reads the server's sentence; a `details.code` from the server would be sturdier.
 */
export function staffErrorKey(error: unknown, fallback: 'previewFailed' | 'sendFailed'): string {
  if (!(error instanceof ApiError)) return `staffMessage.errors.${fallback}`;
  const said = error.message.toLowerCase();
  const key = (() => {
    if (error.statusCode === 403) return 'forbidden';
    if (error.statusCode === 409) {
      return error.details?.['code'] === 'INSUFFICIENT_SMS_CREDIT'
        ? 'insufficientCredit'
        : 'duplicate';
    }
    if (error.statusCode === 400) {
      if (said.includes('too many')) return 'tooMany';
      if (said.includes('phone number')) return 'noPhone';
      if (said.includes('your classes')) return 'noCoordinated';
      if (said.includes('whatsapp')) return 'whatsappNotSet';
      return 'invalid';
    }
    return fallback;
  })();
  return `staffMessage.errors.${key}`;
}

export interface StaffMessageFormProps {
  /** Already-validated user ids from `?people=`. */
  prefillIds?: readonly string[] | undefined;
  /** Drops the `?people=` link param when the sender chooses a different group. */
  onClearPrefill?: (() => void) | undefined;
  /** WhatsApp shows only when the school set it up. */
  whatsappConfigured: boolean;
  onSwitch: (next: 'guardians' | 'staff') => void;
}

export function StaffMessageForm({
  prefillIds = [],
  onClearPrefill,
  whatsappConfigured,
  onSwitch,
}: StaffMessageFormProps) {
  const { t, i18n } = useTranslation('communications');
  const config = useRegionConfig();
  const n = (value: number) => formatNumber(value, config);
  const preview = useStaffMessagePreview();
  const send = useSendStaffMessage();

  const hasPrefill = prefillIds.length > 0;
  const [prefilled, setPrefilled] = React.useState(hasPrefill);
  const [allTeachers, setAllTeachers] = React.useState(!hasPrefill);
  const [allOffice, setAllOffice] = React.useState(false);
  const [more, setMore] = React.useState(hasPrefill);
  const [roles, setRoles] = React.useState<string[]>([]);
  const [designationIds, setDesignationIds] = React.useState<string[]>([]);
  const [userIds, setUserIds] = React.useState<string[]>([...prefillIds]);
  const [medium, setMedium] = React.useState<'SMS' | 'WHATSAPP'>('SMS');
  const [message, setMessage] = React.useState('');
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [needMessage, setNeedMessage] = React.useState(false);
  // A typed, unsent message is lost when the user leaves (e.g. switches to Guardians).
  useWarnUnsavedChanges(message.trim().length > 0 && !send.isSuccess);

  // Names for the prefill banner and the chips.
  const lookupIds = prefillIds.slice(0, PREFILL_NAMES_MAX);
  const nameLookups = useQueries({
    queries: lookupIds.map((id) => ({ ...userQueryOptions(id), retry: false })),
  });
  const knownNames = new Map<string, string>();
  lookupIds.forEach((id, i) => {
    const name = nameLookups[i]?.data?.full_name;
    if (name) knownNames.set(id, name);
  });
  const someNotFound = nameLookups.some((l) => l.isError);

  // "Pick people" asks the server as you type.
  const [query, setQuery] = React.useState('');
  const q = useDebouncedValue(query, 300).trim();
  const users = useUsers({ limit: 100, ...(q ? { search: q } : {}) });
  const peopleOptions: MultiComboboxOption[] = (users.data?.data ?? []).map((u) => ({
    value: u.id,
    label: u.full_name,
  }));
  const [pickedLabels, setPickedLabels] = React.useState<Record<string, string>>({});
  const selectedPeople: MultiComboboxOption[] = userIds.map((id) => ({
    value: id,
    label:
      pickedLabels[id] ??
      knownNames.get(id) ??
      peopleOptions.find((o) => o.value === id)?.label ??
      t('staffMessage.audience.unnamedPerson'),
  }));
  const designations = useDesignations();
  const designationOptions: MultiComboboxOption[] = (designations.data ?? []).map((d) => ({
    value: d.id,
    label: designationTitle(d, i18n.language),
  }));
  const roleOptions: MultiComboboxOption[] = ROLES.map((r) => ({
    value: r,
    label: t(`roles.${r}`, { ns: 'staff' }),
  }));

  const audienceRoles = [...new Set<string>([...(allOffice ? ['OFFICE_STAFF'] : []), ...roles])];
  const audience: StaffAudienceInput = {
    ...(allTeachers ? { teaching: true } : {}),
    ...(audienceRoles.length > 0 ? { roles: audienceRoles as Role[] } : {}),
    ...(designationIds.length > 0 ? { designationIds } : {}),
    ...(userIds.length > 0 ? { userIds } : {}),
  };
  const noGroup = Object.keys(audience).length === 0;
  const isWhatsapp = medium === 'WHATSAPP';
  const payload: StaffMessageInput = {
    audience,
    message: message.trim(),
    medium,
    ...(isWhatsapp
      ? {
          whatsapp_template_name: templateName.trim(),
          whatsapp_template_language: templateLanguage.trim(),
          whatsapp_template_params: splitTemplateParams(templateParams),
        }
      : {}),
  };
  const payloadJson = JSON.stringify(payload);
  const [checkedJson, setCheckedJson] = React.useState<string | null>(null);
  const result = preview.data;
  const fresh = result !== undefined && checkedJson === payloadJson;
  const stale = result !== undefined && !fresh;
  const short = fresh && result.shortfall > 0;
  const nobody = fresh && result.with_phone === 0;
  const canCheck =
    !noGroup && (!isWhatsapp || (templateName.trim() !== '' && templateLanguage.trim() !== ''));
  const canSend = fresh && !short && !nobody;

  function check() {
    if (message.trim() === '') {
      setNeedMessage(true);
      return;
    }
    send.reset();
    preview.mutate(payload, { onSuccess: () => setCheckedJson(payloadJson) });
  }

  function clearPrefill() {
    setPrefilled(false);
    setUserIds([]);
    setAllTeachers(true);
    setMore(false);
    onClearPrefill?.();
  }

  function reset() {
    send.reset();
    preview.reset();
    setCheckedJson(null);
    setMessage('');
    setTemplateName('');
    setTemplateLanguage('');
    setTemplateParams('');
  }

  const header = (
    <>
      <SendAudienceSwitch value="staff" onChange={onSwitch} />
      <header>
        <h1 className="text-h1">{t('staffMessage.title')}</h1>
        <p className="mt-0.5 text-text-secondary">{t('staffMessage.description')}</p>
      </header>
    </>
  );

  if (send.isSuccess) {
    const r = send.data;
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card padded aria-labelledby="staff-result-title">
          <h2 id="staff-result-title" className="text-h2">
            {t('staffMessage.send.successTitle')}
          </h2>
          <p className="mt-1 text-text-secondary">
            {t('staffMessage.send.successDescription', { queued: n(r.queued) })}
          </p>
          {r.failed > 0 && (
            <p className="mt-1 text-destructive">
              {t('staffMessage.send.successFailed', { failed: n(r.failed) })}
            </p>
          )}
          {r.skipped.length > 0 && (
            <p className="mt-1 text-text-secondary">
              {t('staffMessage.send.successSkipped', { skipped: n(r.skipped.length) })}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
            <Button asChild variant="outline">
              <Link to="/communications/message-log">{t('staffMessage.send.viewLog')}</Link>
            </Button>
            <Button type="button" onClick={reset}>
              {t('staffMessage.send.another')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const errorKey = send.isError
    ? send.error instanceof ApiError && send.error.statusCode < 500
      ? staffErrorKey(send.error, 'sendFailed')
      : 'staffMessage.errors.unknownOutcome'
    : preview.isError
      ? staffErrorKey(preview.error, 'previewFailed')
      : null;
  const names = [...knownNames.values()];
  const unnamed = prefillIds.length - names.length;

  return (
    <div className="flex flex-col gap-4">
      {header}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) setConfirmOpen(true);
          else if (canCheck) check();
        }}
        noValidate
      >
        <Card padded className="flex flex-col gap-5">
          {prefilled && (
            <NoticeBar tone="info">
              <p>
                {unnamed > 0
                  ? t('staffMessage.entry.prefillBannerMore', {
                      names: names.slice(0, 3).join(', '),
                      count: n(unnamed + Math.max(0, names.length - 3)),
                    })
                  : t('staffMessage.entry.prefillBanner', { names: names.join(', ') })}
              </p>
              <p className="text-caption">{t('staffMessage.entry.prefillHelp')}</p>
              {someNotFound && <p>{t('staffMessage.entry.prefillNotFound')}</p>}
              <Button type="button" variant="link" onClick={clearPrefill}>
                {t('staffMessage.entry.prefillClear')}
              </Button>
            </NoticeBar>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="flex items-center gap-1 text-label">
              {t('staffMessage.audience.title')}
            </legend>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="staff-all-teachers"
                checked={allTeachers}
                onCheckedChange={(next) => setAllTeachers(next === true)}
              />
              <label htmlFor="staff-all-teachers" className="text-label">
                {t('staffMessage.audience.allTeachers')}
              </label>
            </div>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="staff-all-office"
                checked={allOffice}
                onCheckedChange={(next) => setAllOffice(next === true)}
              />
              <label htmlFor="staff-all-office" className="text-label">
                {t('staffMessage.audience.allOffice')}
              </label>
            </div>
            <Button
              type="button"
              variant="link"
              className="self-start"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
            >
              {more ? t('staffMessage.audience.chooseLess') : t('staffMessage.audience.chooseMore')}
            </Button>
            {more && (
              <div className="flex flex-col gap-4 ps-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-roles">{t('staffMessage.audience.role')}</Label>
                  <MultiCombobox
                    id="staff-roles"
                    aria-label={t('staffMessage.audience.role')}
                    placeholder={t('staffMessage.audience.rolePlaceholder')}
                    options={roleOptions}
                    value={roles}
                    onValueChange={setRoles}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-designations">
                    {t('staffMessage.audience.designation')}
                  </Label>
                  <MultiCombobox
                    id="staff-designations"
                    aria-label={t('staffMessage.audience.designation')}
                    placeholder={t('staffMessage.audience.designationPlaceholder')}
                    options={designationOptions}
                    value={designationIds}
                    onValueChange={setDesignationIds}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-people">{t('staffMessage.audience.people')}</Label>
                  {userIds.length > 0 && (
                    <ul
                      className="flex flex-wrap gap-2"
                      aria-label={t('staffMessage.audience.people')}
                    >
                      {selectedPeople.map((o) => (
                        <li key={o.value}>
                          <button
                            type="button"
                            aria-label={o.label}
                            onClick={() => setUserIds(userIds.filter((x) => x !== o.value))}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border-functional bg-muted px-3 text-label hover:bg-secondary md:min-h-8"
                          >
                            {o.label}
                            <XIcon className="size-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Combobox
                    id="staff-people"
                    aria-label={t('staffMessage.audience.people')}
                    placeholder={t('staffMessage.audience.peoplePlaceholder')}
                    emptyText={t('staffMessage.audience.peopleNoResults')}
                    options={peopleOptions.filter((o) => !userIds.includes(o.value))}
                    value={null}
                    onQueryChange={setQuery}
                    onValueChange={(next) => {
                      if (!next) return;
                      const label = peopleOptions.find((o) => o.value === next)?.label;
                      if (label) setPickedLabels((prev) => ({ ...prev, [next]: label }));
                      setUserIds([...userIds, next]);
                    }}
                  />
                </div>
              </div>
            )}
            {noGroup && (
              <p role="alert" className="text-caption text-destructive">
                {t('staffMessage.audience.empty')}
              </p>
            )}
          </fieldset>

          {whatsappConfigured && (
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-1 text-label">
                {t('staffMessage.medium.label')}
              </legend>
              <RadioGroup
                value={medium}
                onValueChange={(v) => setMedium(v as 'SMS' | 'WHATSAPP')}
                className="flex gap-4"
              >
                {(['SMS', 'WHATSAPP'] as const).map((m) => (
                  <div key={m} className="flex min-h-11 items-center gap-2">
                    <RadioGroupItem id={`staff-medium-${m}`} value={m} />
                    <label htmlFor={`staff-medium-${m}`}>
                      {t(`staffMessage.medium.${m === 'SMS' ? 'sms' : 'whatsapp'}`)}
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-message">{t('staffMessage.message.label')}</Label>
            <Textarea
              id="staff-message"
              rows={5}
              value={message}
              placeholder={t('staffMessage.message.placeholder')}
              onChange={(event) => {
                setMessage(event.target.value);
                setNeedMessage(false);
              }}
              aria-invalid={needMessage}
            />
            {needMessage && (
              <p role="alert" className="text-caption text-destructive">
                {t('staffMessage.message.required')}
              </p>
            )}
            {!isWhatsapp && <SmsSegmentCounter text={message} />}
          </div>

          {isWhatsapp && (
            <div className="flex flex-col gap-3">
              <WhatsappTemplateFields
                idPrefix="staff"
                helperText={t('staffMessage.whatsapp.help')}
                templateName={templateName}
                onTemplateNameChange={setTemplateName}
                templateLanguage={templateLanguage}
                onTemplateLanguageChange={setTemplateLanguage}
                templateParams={templateParams}
                onTemplateParamsChange={setTemplateParams}
              />
              <section aria-label={t('staffMessage.whatsapp.deliveredTitle')}>
                <h2 className="text-label">{t('staffMessage.whatsapp.deliveredTitle')}</h2>
                <p className="text-text-secondary">
                  {fresh && result.whatsapp_template
                    ? [result.whatsapp_template.name, ...result.whatsapp_template.params].join(' ')
                    : t('staffMessage.whatsapp.deliveredEmpty')}
                </p>
              </section>
            </div>
          )}

          <section
            aria-labelledby="staff-preview-title"
            className="flex flex-col gap-3 border-t border-border-subtle pt-4"
          >
            <h2 id="staff-preview-title" className="text-h2">
              {t('staffMessage.preview.title')}
            </h2>
            {preview.isPending && <p>{t('staffMessage.preview.loading')}</p>}
            {stale && <NoticeBar tone="warning">{t('staffMessage.preview.stale')}</NoticeBar>}
            {fresh && (
              <div className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label={t('staffMessage.preview.people')} value={n(result.people)} />
                  <Stat label={t('staffMessage.preview.withPhone')} value={n(result.with_phone)} />
                  <Stat
                    label={t('staffMessage.preview.credits')}
                    value={n(result.credits_needed)}
                  />
                  <Stat
                    label={t('staffMessage.preview.balance')}
                    value={
                      result.balance === null
                        ? t('staffMessage.preview.balanceUnknown')
                        : n(result.balance)
                    }
                  />
                </dl>
                {!isWhatsapp && (
                  <p className="text-caption text-text-secondary">
                    {t('staffMessage.preview.smsEach', { count: result.segments_each })}
                  </p>
                )}
                {nobody && (
                  <NoticeBar tone="warning">{t('staffMessage.preview.nobodyTitle')}</NoticeBar>
                )}
                <section>
                  <h3 className="text-label">
                    {t('staffMessage.preview.skippedTitle', { count: n(result.skipped.length) })}
                  </h3>
                  {result.skipped.length === 0 ? (
                    <p className="text-text-secondary">{t('staffMessage.preview.skippedNone')}</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {result.skipped.map((s) => (
                        <li key={s.user_id} className="rounded-md border border-border-subtle p-3">
                          <p className="font-medium">{s.name}</p>
                          <p className="text-caption text-text-secondary">
                            {t(
                              s.reason === 'no_phone'
                                ? 'staffMessage.skipReasons.no_phone'
                                : 'staffMessage.skipReasons.unknown',
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
            {short && (
              <p role="alert" className="flex items-center gap-1 text-destructive">
                <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                <span>
                  {t('staffMessage.preview.shortfall', { count: n(result.shortfall) })}{' '}
                  {t('staffMessage.preview.shortfallHelp')}
                </span>
              </p>
            )}
            {errorKey !== null && !confirmOpen && (
              <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                {t(errorKey)}
              </p>
            )}
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              loading={preview.isPending}
              disabled={!canCheck}
              onClick={check}
            >
              {result === undefined
                ? t('staffMessage.preview.action')
                : t('staffMessage.preview.refresh')}
            </Button>
            <Button type="submit" disabled={!canSend}>
              <SendIcon aria-hidden />
              {t('staffMessage.send.action')}
            </Button>
          </div>
        </Card>
      </form>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && send.isPending) return;
          if (!open) send.reset();
          setConfirmOpen(open);
        }}
      >
        <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
          <DialogHeader>
            <DialogTitle>{t('staffMessage.send.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {fresh
                ? t('staffMessage.send.confirmDescription', {
                    withPhone: n(result.with_phone),
                    credits: n(result.credits_needed),
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap">{message}</p>
          {errorKey !== null && send.isError && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
              {t(errorKey)}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={send.isPending}>
                {t('staffMessage.send.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              loading={send.isPending}
              onClick={() => send.mutate(payload, { onSuccess: () => setConfirmOpen(false) })}
            >
              {send.isPending ? t('staffMessage.send.sending') : t('staffMessage.send.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle p-3">
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="text-h2">{value}</dd>
    </div>
  );
}
