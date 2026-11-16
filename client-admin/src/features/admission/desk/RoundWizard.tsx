/**
 * [71.4.x] New admission round — four steps with every field pre-filled so "Next" works untyped.
 * Words follow `docs/ux-research/epic-71-admission-glossary.md` (ভর্তি রাউন্ড, ধাপ, আসন).
 */
import { ADMISSION_TEMPLATES, AdmissionPayMethod, AdmissionTemplateKey } from '@biddaloy/shared';
import {
  AdmissionFieldPicker,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@biddaloy/ui/components';
import { useAcademicYears, useAllClasses, useCreateAdmissionRound } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { WizardShell } from '@biddaloy/ui/shells';
import { parseServerDate, tenantTodayIso, toIsoDate } from '@biddaloy/ui/utils';
import { Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

type PublishChannel = 'SITE' | 'SMS' | 'STATUS_CHECK' | 'CALL_LIST';

export interface WizardState {
  classId: string;
  yearId: string;
  template: AdmissionTemplateKey;
  seats: string;
  openDate: string;
  closeDate: string;
  rollPrefix: string;
  fee: string;
  methods: string[];
  fields: string[];
  channels: PublishChannel[];
  alwaysShow: boolean;
}

const TEMPLATE_ORDER = [
  AdmissionTemplateKey.APPLY_ONLY,
  AdmissionTemplateKey.WRITTEN,
  AdmissionTemplateKey.WRITTEN_VIVA,
  AdmissionTemplateKey.LOTTERY,
  AdmissionTemplateKey.FIRST_COME,
  AdmissionTemplateKey.GPA_MERIT,
] as const;
/** No server cap exists; this stops typos like an extra zero. */
export const MAX_SEATS = 100000;
const STEP_IDS = ['kind', 'dates', 'fee', 'publish'] as const;
const GROUP_KEYS = ['child', 'parents', 'guardian', 'address', 'previous', 'quota', 'other'];

/** Taka text -> whole paisa. Empty = no fee (null); more than 2 decimals or junk = `undefined`. */
export function feeToPaisa(text: string): number | null | undefined {
  const v = text.trim();
  if (v === '') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function addDays(iso: string, days: number): string {
  const d = parseServerDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function initialWizardState(today: string): WizardState {
  return {
    classId: '',
    yearId: '',
    template: AdmissionTemplateKey.WRITTEN,
    seats: '30',
    openDate: today,
    closeDate: addDays(today, 30),
    rollPrefix: '',
    fee: '',
    methods: [AdmissionPayMethod.BKASH, AdmissionPayMethod.NAGAD],
    fields: [...ADMISSION_TEMPLATES[AdmissionTemplateKey.WRITTEN].fields],
    channels: ['SITE', 'STATUS_CHECK'],
    alwaysShow: false,
  };
}

const toggleIn = <T,>(list: readonly T[], item: T, on: boolean): T[] =>
  on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);

function FieldBox({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div>
        <p className="text-body">{label}</p>
        {hint ? <p className="text-caption text-text-secondary">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function RoundWizard() {
  const { t, i18n } = useTranslation('admission-desk');
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const years = useAcademicYears();
  const create = useCreateAdmissionRound();
  const [step, setStep] = React.useState<string>(STEP_IDS[0]);
  const [s, setS] = React.useState<WizardState>(() =>
    initialWizardState(tenantTodayIso(regionConfig)),
  );
  // The server takes the round's year from the class, so the class list follows the chosen year.
  // Every page: a plain useClasses() stops at 100.
  const classes = useAllClasses({ enabled: s.yearId !== '', academicYearId: s.yearId });
  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const classList = React.useMemo(() => classes.data ?? [], [classes.data]);
  const yearList = React.useMemo(() => years.data?.data ?? [], [years.data]);
  // Pre-fill: the first class and the current year, so Next works without typing.
  React.useEffect(() => {
    setS((prev) => ({
      ...prev,
      classId: prev.yearId && !prev.classId ? (classList[0]?.id ?? '') : prev.classId,
      yearId: prev.yearId || (yearList.find((y) => y.is_current) ?? yearList[0])?.id || '',
    }));
  }, [classList, yearList]);

  const locale: 'bn' | 'en' = i18n.language.startsWith('bn') ? 'bn' : 'en';
  const feePaisa = feeToPaisa(s.fee);
  const seatsOk = /^\d+$/.test(s.seats) && Number(s.seats) > 0 && Number(s.seats) <= MAX_SEATS;
  const rangeOk = s.openDate !== '' && s.closeDate !== '' && s.openDate <= s.closeDate;
  const feeError = feePaisa === undefined ? t('wizard.errors.fee') : null;
  const template = ADMISSION_TEMPLATES[s.template];
  const groupLabels = Object.fromEntries(GROUP_KEYS.map((g) => [g, t(`wizard.groups.${g}`)]));

  function submit() {
    const klass = classList.find((c) => c.id === s.classId);
    const year = yearList.find((y) => y.id === s.yearId);
    create.mutate(
      {
        title: t('wizard.defaultTitle', {
          class: klass?.name ?? '',
          year: year?.name ?? '',
        }).trim(),
        class_id: s.classId,
        template_key: s.template,
        seat_count: Number(s.seats),
        open_date: s.openDate,
        close_date: s.closeDate,
        required_document_types: [],
        roll_prefix: s.rollPrefix.trim() || null,
        fee_amount_paisa: feePaisa || null,
        fee_pay_methods: feePaisa ? (s.methods as ('BKASH' | 'NAGAD' | 'ROCKET' | 'BANK')[]) : [],
        form_fields: s.fields as never,
        publish_channels: s.channels,
        widget_always_show: s.alwaysShow,
      },
      {
        onSuccess: (round) =>
          void navigate({ to: '/admissions/rounds/$roundId', params: { roundId: round.id } }),
      },
    );
  }

  const steps = [
    {
      id: 'kind',
      label: t('wizard.steps.kind'),
      isValid: () => s.classId !== '',
      content: (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <FieldBox
              id="wz-class"
              label={t('wizard.class')}
              error={s.classId === '' ? t('wizard.errors.class') : null}
            >
              <Select value={s.classId} onValueChange={(v) => patch({ classId: v })}>
                <SelectTrigger id="wz-class">
                  <SelectValue placeholder={t('wizard.pick')} />
                </SelectTrigger>
                <SelectContent>
                  {classList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBox>
            <FieldBox id="wz-year" label={t('wizard.year')}>
              <Select value={s.yearId} onValueChange={(v) => patch({ yearId: v, classId: '' })}>
                <SelectTrigger id="wz-year">
                  <SelectValue placeholder={t('wizard.pick')} />
                </SelectTrigger>
                <SelectContent>
                  {yearList.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBox>
          </div>
          <h2 className="text-h2">{t('wizard.kindTitle')}</h2>
          <p className="text-text-secondary">{t('wizard.kindHelp')}</p>
          <RadioGroup
            aria-label={t('wizard.kindTitle')}
            value={s.template}
            onValueChange={(v) => {
              const key = v as AdmissionTemplateKey;
              patch({ template: key, fields: [...ADMISSION_TEMPLATES[key].fields] });
            }}
            className="grid gap-3 md:grid-cols-2"
          >
            {TEMPLATE_ORDER.map((key) => (
              <label
                key={key}
                htmlFor={`wz-kind-${key}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3"
              >
                <RadioGroupItem
                  id={`wz-kind-${key}`}
                  value={key}
                  aria-label={t(`wizard.templates.${key}.name`)}
                />
                <span>
                  <span className="block text-body font-medium">
                    {t(`wizard.templates.${key}.name`)}
                    {key === AdmissionTemplateKey.WRITTEN ? ` · ${t('wizard.mostUsed')}` : ''}
                  </span>
                  <span className="block text-caption text-text-secondary">
                    {t(`wizard.templates.${key}.help`)}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
      ),
    },
    {
      id: 'dates',
      label: t('wizard.steps.dates'),
      isValid: () => seatsOk && rangeOk,
      content: (
        <div className="grid gap-4 md:grid-cols-2">
          <FieldBox
            id="wz-seats"
            label={t('wizard.seats')}
            error={seatsOk ? null : t('wizard.errors.seats')}
          >
            <Input
              id="wz-seats"
              inputMode="numeric"
              value={s.seats}
              aria-invalid={!seatsOk}
              onChange={(e) => patch({ seats: e.target.value })}
            />
          </FieldBox>
          <FieldBox id="wz-prefix" label={t('wizard.rollPrefix')}>
            <Input
              id="wz-prefix"
              maxLength={10}
              value={s.rollPrefix}
              onChange={(e) => patch({ rollPrefix: e.target.value })}
            />
          </FieldBox>
          <FieldBox id="wz-open" label={t('wizard.openDate')}>
            <DatePicker
              id="wz-open"
              aria-label={t('wizard.openDate')}
              config={regionConfig}
              value={s.openDate ? parseServerDate(s.openDate) : undefined}
              onValueChange={(d) => patch({ openDate: d ? toIsoDate(d) : '' })}
            />
          </FieldBox>
          <FieldBox
            id="wz-close"
            label={t('wizard.closeDate')}
            error={s.openDate && s.closeDate && !rangeOk ? t('wizard.errors.range') : null}
          >
            <DatePicker
              id="wz-close"
              aria-label={t('wizard.closeDate')}
              config={regionConfig}
              value={s.closeDate ? parseServerDate(s.closeDate) : undefined}
              onValueChange={(d) => patch({ closeDate: d ? toIsoDate(d) : '' })}
            />
          </FieldBox>
          <p className="text-caption text-text-secondary md:col-span-2">{t('wizard.datesHelp')}</p>
        </div>
      ),
    },
    {
      id: 'fee',
      label: t('wizard.steps.fee'),
      isValid: () =>
        feePaisa !== undefined && (!feePaisa || s.methods.length > 0) && s.fields.length > 0,
      content: (
        <div className="flex flex-col gap-5">
          <h2 className="text-h2">{t('wizard.feeTitle')}</h2>
          <FieldBox id="wz-fee" label={t('wizard.fee')} error={feeError}>
            <Input
              id="wz-fee"
              inputMode="decimal"
              value={s.fee}
              aria-invalid={feeError !== null}
              onChange={(e) => patch({ fee: e.target.value })}
            />
          </FieldBox>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label">{t('wizard.methods')}</legend>
            {Object.values(AdmissionPayMethod).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-3 md:min-h-8">
                <Checkbox
                  checked={s.methods.includes(m)}
                  onCheckedChange={(c) => patch({ methods: toggleIn(s.methods, m, c === true) })}
                />
                {t(`wizard.method.${m}`)}
              </label>
            ))}
          </fieldset>
          {feePaisa && s.methods.length === 0 ? (
            <p role="alert" className="text-caption text-destructive">
              {t('wizard.errors.method')}
            </p>
          ) : null}
          <p className="text-caption text-text-secondary">{t('wizard.feeHelp')}</p>
          <h2 className="text-h2">{t('wizard.fieldsTitle')}</h2>
          <AdmissionFieldPicker
            value={s.fields}
            onChange={(keys) => patch({ fields: keys })}
            recommended={template.fields}
            locale={locale}
            groupLabels={groupLabels}
            searchLabel={t('wizard.fieldSearch')}
            recommendedLabel={t('wizard.recommended')}
            noMatchText={t('wizard.noFieldMatch')}
            countLabel={(count) => t('wizard.fieldCount', { count })}
          />
        </div>
      ),
    },
    {
      id: 'publish',
      label: t('wizard.steps.publish'),
      content: (
        <div className="flex flex-col gap-3">
          <h2 className="text-h2">{t('wizard.resultTitle')}</h2>
          {(['SITE', 'SMS', 'STATUS_CHECK', 'CALL_LIST'] as const).map((c) => (
            <ToggleRow
              key={c}
              label={t(`wizard.channel.${c}`)}
              checked={s.channels.includes(c)}
              onChange={(on) => patch({ channels: toggleIn(s.channels, c, on) })}
            />
          ))}
          <h2 className="mt-2 text-h2">{t('wizard.siteTitle')}</h2>
          <ToggleRow
            label={t('wizard.alwaysShow')}
            hint={t('wizard.alwaysShowHint')}
            checked={s.alwaysShow}
            onChange={(on) => patch({ alwaysShow: on })}
          />
          <Button asChild variant="link" className="self-start">
            <Link to="/website" target="_blank" rel="noopener noreferrer">
              {t('wizard.siteEditor')}
            </Link>
          </Button>
          {create.isError ? (
            <p role="alert" className="text-destructive">
              {t('wizard.errors.create')}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <WizardShell
      title={t('wizard.title')}
      steps={steps}
      currentStepId={step}
      onStepChange={setStep}
      onSubmit={submit}
      submitLabel={t('wizard.create')}
      submitting={create.isPending}
    />
  );
}
