/**
 * [71.4.05] A clerk enters an application for a walk-in guardian. The boxes come from the round's
 * ticked fields; five of them are real columns, the rest ride in `extra_fields`. Words follow
 * `docs/ux-research/epic-71-admission-glossary.md`.
 */
import {
  ADMISSION_FIELD_CATALOGUE,
  fieldsForRound,
  validateExtraFields,
  type AdmissionFieldDef,
} from '@biddaloy/shared';
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useAdmissionRound, useAdmissionRounds } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { useNavigate, useSearch } from '@tanstack/react-router';
import * as React from 'react';

import {
  useCreateApplicantStaff,
  type StaffApplicantResult,
} from '../hooks/useCreateApplicantStaff';

/** The five boxes the server stores as columns (mirrors `CORE_FORM_KEYS`); always shown. */
const CORE = ['name', 'dob', 'gender', 'guardian_name', 'guardian_phone'] as const;
/** Mirrors the server's `BD_PHONE_REGEX` (`server/src/modules/students/dto/students.dto.ts`). */
const PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;
type Value = string | boolean;

export function ClerkEntryPage() {
  const { t, i18n } = useTranslation('admission-desk');
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const [roundId, setRoundId] = React.useState(search.round ?? '');
  const rounds = useAdmissionRounds();
  const round = useAdmissionRound(roundId);
  const create = useCreateApplicantStaff();

  const [values, setValues] = React.useState<Record<string, Value>>({});
  const [docs, setDocs] = React.useState<Record<string, File>>({});
  const [docsLater, setDocsLater] = React.useState(false);
  const [feeMethod, setFeeMethod] = React.useState('');
  const [feeRef, setFeeRef] = React.useState('');
  const [feeProof, setFeeProof] = React.useState<File | undefined>();
  const [afterClose, setAfterClose] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [result, setResult] = React.useState<StaffApplicantResult | null>(null);
  const [failed, setFailed] = React.useState(false);

  const close = useCloseFullPage(
    () =>
      void (roundId
        ? navigate({ to: '/admissions/rounds/$roundId', params: { roundId } })
        : navigate({ to: '/admissions/intakes' })),
  );
  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';
  const data = round.data;
  const feeRound = (data?.fee_amount_paisa ?? 0) > 0;
  const closed = Boolean(data?.status && data.status !== 'OPEN');
  const extras = fieldsForRound(data?.form_fields ?? []).filter(
    (f) => !(CORE as readonly string[]).includes(f.key) && f.input !== 'file',
  );
  const shown: AdmissionFieldDef[] = [
    ...CORE.map((k) => ADMISSION_FIELD_CATALOGUE.find((f) => f.key === k)!),
    ...extras,
  ];
  const docTypes = docsLater ? [] : (data?.required_document_types ?? []);

  const set = (key: string, v: Value) => setValues((prev) => ({ ...prev, [key]: v }));
  const text = (key: string) => (typeof values[key] === 'string' ? values[key] : '');

  // Field-keyed codes only; the typed value is never shown back (Rule 23).
  const errors: Record<string, string> = {};
  for (const k of CORE) {
    if (text(k).trim() === '') errors[k] = 'REQUIRED';
  }
  if (!errors.guardian_phone && !PHONE.test(text('guardian_phone')))
    errors.guardian_phone = 'INVALID';
  const extraValues: Record<string, string | number | boolean> = {};
  for (const f of extras) {
    const v = values[f.key];
    if (v === undefined || v === '' || v === false) continue;
    extraValues[f.key] = f.input === 'number' ? Number(v) : v;
  }
  Object.assign(
    errors,
    validateExtraFields(
      extras.map((f) => f.key),
      extraValues,
    ),
  );
  if (feeRound) {
    if (!feeMethod) errors._feeMethod = 'REQUIRED';
    if (!feeProof) errors._feeProof = 'REQUIRED';
  }
  for (const type of docTypes) {
    if (!docs[type.toLowerCase()]) errors[`_doc_${type}`] = 'REQUIRED';
  }
  const hasErrors = Object.keys(errors).length > 0;

  function submit() {
    if (!data || create.isPending) return;
    setShowErrors(true);
    if (hasErrors) return;
    setFailed(false);
    create.mutate(
      {
        intake_id: roundId,
        applicant_name: text('name').trim(),
        date_of_birth: text('dob'),
        gender: text('gender'),
        guardian_name: text('guardian_name').trim(),
        guardian_phone: text('guardian_phone'),
        extra_fields: extraValues,
        ...(closed && afterClose ? { allow_after_close: true } : {}),
        ...(feeRound ? { fee_method: feeMethod, fee_reference: feeRef.trim() } : {}),
        documents: docsLater ? {} : docs,
        ...(feeRound && feeProof ? { fee_proof: feeProof } : {}),
      },
      { onSuccess: setResult, onError: () => setFailed(true) },
    );
  }

  // Ctrl+Enter (Cmd+Enter on a Mac) saves from any box. Re-bound each render so it sees the latest values.
  React.useEffect(() => {
    if (result) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function another() {
    setValues({});
    setDocs({});
    setFeeMethod('');
    setFeeRef('');
    setFeeProof(undefined);
    setShowErrors(false);
    setResult(null);
  }

  const err = (key: string) =>
    showErrors && errors[key] ? (
      <p role="alert" className="text-sm text-destructive">
        {t(`clerk.errors.${errors[key]}`)}
      </p>
    ) : null;

  function control(f: AdmissionFieldDef) {
    const id = `clerk-${f.key}`;
    switch (f.input) {
      case 'textarea':
        return (
          <Textarea id={id} value={text(f.key)} onChange={(e) => set(f.key, e.target.value)} />
        );
      case 'boolean':
        return (
          <Checkbox
            id={id}
            checked={values[f.key] === true}
            onCheckedChange={(c) => set(f.key, c === true)}
          />
        );
      case 'select':
        return (
          <Select value={text(f.key)} onValueChange={(v) => set(f.key, v)}>
            <SelectTrigger id={id}>
              <SelectValue placeholder={t('clerk.pick')} />
            </SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`clerk.options.${o}`, { defaultValue: o })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            id={id}
            type={f.input === 'date' ? 'date' : f.input === 'number' ? 'number' : 'text'}
            inputMode={f.input === 'phone' ? 'tel' : undefined}
            value={text(f.key)}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
    }
  }

  const file = (key: string, label: string, onPick: (f: File | undefined) => void) => (
    <div key={key} className="flex flex-col gap-1">
      <Label htmlFor={`clerk-file-${key}`}>{label}</Label>
      <Input id={`clerk-file-${key}`} type="file" onChange={(e) => onPick(e.target.files?.[0])} />
      {err(key)}
    </div>
  );

  return (
    <FullPageShell
      title={t('clerk.title')}
      onClose={close}
      dirty={!result && Object.keys(values).length > 0}
      primary={
        result
          ? { label: t('clerk.another'), onClick: another }
          : {
              label: t('clerk.save'),
              onClick: submit,
              busy: create.isPending,
              disabled: !data,
            }
      }
    >
      {result ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-lg font-semibold">
            {t('clerk.done', { ref: result.reference_number })}
          </p>
          {result.warnings?.includes('REFERENCE_SEEN') ? (
            <p className="rounded-md bg-status-due-bg p-3 text-sm text-status-due-fg">
              {t('clerk.referenceSeen')}
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="clerk-round">{t('clerk.round')}</Label>
            <Select
              value={roundId}
              onValueChange={(id) => {
                // A fee method, documents and "after close" belong to one round: start them over.
                setRoundId(id);
                setFeeMethod('');
                setFeeProof(undefined);
                setDocs({});
                setAfterClose(false);
              }}
            >
              <SelectTrigger id="clerk-round">
                <SelectValue placeholder={t('clerk.pick')} />
              </SelectTrigger>
              <SelectContent>
                {(rounds.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {data ? (
            <>
              {shown.map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <Label htmlFor={`clerk-${f.key}`}>
                    {f.label[lang]}
                    {(CORE as readonly string[]).includes(f.key) || f.required ? ' *' : ''}
                  </Label>
                  {control(f)}
                  <p className="text-xs text-muted-foreground">{t(f.help)}</p>
                  {err(f.key)}
                </div>
              ))}

              {(data.required_document_types ?? []).length > 0 ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="clerk-docs-later"
                    checked={docsLater}
                    onCheckedChange={(c) => setDocsLater(c === true)}
                  />
                  <Label htmlFor="clerk-docs-later">{t('clerk.docsLater')}</Label>
                </div>
              ) : null}
              {docTypes.map((type) =>
                file(`_doc_${type}`, t(`clerk.docs.${type}`), (f) =>
                  setDocs((prev) => {
                    const next = { ...prev };
                    if (f) next[type.toLowerCase()] = f;
                    else delete next[type.toLowerCase()];
                    return next;
                  }),
                ),
              )}

              {feeRound ? (
                <fieldset className="flex flex-col gap-3 rounded-md border p-3">
                  <legend className="px-1 font-medium">{t('clerk.feeTitle')}</legend>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="clerk-fee-method">{t('clerk.feeMethod')} *</Label>
                    <Select value={feeMethod} onValueChange={setFeeMethod}>
                      <SelectTrigger id="clerk-fee-method">
                        <SelectValue placeholder={t('clerk.pick')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(data.fee_pay_methods ?? []).map((m) => (
                          <SelectItem key={m} value={m}>
                            {t(`wizard.method.${m}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {err('_feeMethod')}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="clerk-fee-ref">{t('clerk.feeReference')}</Label>
                    <Input
                      id="clerk-fee-ref"
                      value={feeRef}
                      maxLength={100}
                      onChange={(e) => setFeeRef(e.target.value)}
                    />
                  </div>
                  {file('_feeProof', `${t('clerk.feeProof')} *`, setFeeProof)}
                </fieldset>
              ) : null}

              {closed ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="clerk-after-close"
                    checked={afterClose}
                    onCheckedChange={(c) => setAfterClose(c === true)}
                  />
                  <Label htmlFor="clerk-after-close">{t('clerk.afterClose')}</Label>
                </div>
              ) : null}
            </>
          ) : null}

          {failed ? <p role="alert">{t('clerk.errors.create')}</p> : null}
          <p className="text-xs text-muted-foreground">{t('clerk.shortcut')}</p>
        </form>
      )}
    </FullPageShell>
  );
}
