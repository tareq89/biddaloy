/**
 * [48.3.B-01] Step 2: language (= template, D10), the issue-time fields (D3, D43), the profile
 * values the certificate will carry, the next serial, and the whole-class switch (D22).
 */
import { formatSerial, type DocumentKind, type FieldDef } from '@biddaloy/shared';
import {
  Button,
  Card,
  Field,
  FieldGrid,
  Input,
  Label,
  Textarea,
  ChoiceCards,
} from '@biddaloy/ui/components';
import { type CertificateTemplateRow, type RegisterRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { UsersIcon } from 'lucide-react';

import { kindReasonKey } from './kind-step';
import type { IneligibleStudent } from './print-step';

/** `DAHS-TC-2026-00007` -> prefix `DAHS`; `TSM-2026-00009` -> no prefix. */
function nextSerial(kind: DocumentKind, year: number, latest: RegisterRow | undefined): string {
  const parts = latest?.serial.split('-') ?? [];
  const prefix = parts.length > 3 ? parts.slice(0, -3).join('-') : undefined;
  return formatSerial({ kind, year, n: (latest?.serial_no ?? 0) + 1, prefix });
}

export interface DetailsStepProps {
  studentId: string;
  studentName: string;
  kind: DocumentKind;
  kindLabel: string;
  templates: CertificateTemplateRow[];
  templateId: string | undefined;
  onTemplateChange: (id: string) => void;
  fields: FieldDef[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /** Field key -> message, shown once the person tried to continue. */
  errors: Record<string, string>;
  fieldLabel: (key: string) => string;
  profileValues: Array<{ key: string; value: string }>;
  year: number;
  latest: RegisterRow | undefined;
  issuedCount: number;
  bulk:
    | {
        className: string;
        count: number;
        enabled: boolean;
        loading: boolean;
        tooMany: boolean;
        onToggle: () => void;
      }
    | undefined;
  ineligible: Array<IneligibleStudent & { name: string }>;
}

export function DetailsStep(props: DetailsStepProps) {
  const { t } = useTranslation('certificates');
  const region = useRegionConfig();
  const { kind, fields, values, errors } = props;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-6">
        {props.ineligible.length > 0 ? (
          <Card padded role="alert" className="border-destructive">
            <p className="font-medium">
              {t('bulk.ineligible', {
                count: props.ineligible.length,
                n: formatNumber(props.ineligible.length, region),
              })}
            </p>
            <ul className="mt-2 list-disc ps-5">
              {props.ineligible.map((s) => (
                <li key={s.id}>
                  {s.name} — {t(kindReasonKey(s.reason))}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card padded>
          <h2 className="text-h2">{t('language.title')}</h2>
          <p className="mt-1 mb-3 text-text-secondary">{t('language.help')}</p>
          <ChoiceCards
            label={t('language.title')}
            value={props.templateId}
            onValueChange={props.onTemplateChange}
            columns={2}
            options={props.templates.map((tpl) => ({
              value: tpl.id,
              title: tpl.name,
              ...(tpl.is_default ? { description: t('language.default') } : {}),
            }))}
          />
        </Card>

        <Card padded>
          <h2 className="text-h2">{t('fields.title')}</h2>
          <p className="mt-1 mb-4 text-text-secondary">{t('fields.help')}</p>
          {fields.length === 0 ? (
            <p className="text-text-secondary">{t('fields.none')}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((f) => {
                const max = f.issueTime?.maxLength ?? 0;
                const value = values[f.key] ?? '';
                const id = `issue-${f.key}`;
                const err = errors[f.key];
                const common = {
                  id,
                  value,
                  'aria-invalid': err ? true : undefined,
                  'aria-describedby': `${id}-hint`,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    props.onValueChange(f.key, e.target.value),
                };
                return (
                  <div
                    key={f.key}
                    className={
                      max > 120 ? 'flex flex-col gap-1.5 md:col-span-2' : 'flex flex-col gap-1.5'
                    }
                  >
                    <Label htmlFor={id}>
                      {props.fieldLabel(f.key)}{' '}
                      <span aria-hidden="true" className="text-destructive">
                        *
                      </span>
                    </Label>
                    {max > 120 ? <Textarea rows={4} {...common} /> : <Input {...common} />}
                    <div id={`${id}-hint`} className="flex justify-between gap-2 text-caption">
                      <span role={err ? 'alert' : undefined} className="text-destructive">
                        {err ?? ''}
                      </span>
                      <span className="text-text-secondary">
                        {t('fields.count', {
                          n: formatNumber(value.length, region),
                          max: formatNumber(max, region),
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {props.profileValues.length > 0 ? (
          <Card padded>
            <h2 className="text-h2">{t('profile.title')}</h2>
            <div className="mt-3">
              <FieldGrid>
                {props.profileValues.map((v) => (
                  <Field key={v.key} label={props.fieldLabel(v.key)}>
                    {v.value}
                  </Field>
                ))}
              </FieldGrid>
            </div>
            <p className="mt-4 border-t border-border-subtle pt-3">
              {t('profile.wrong')}{' '}
              <Link
                to="/students/$studentId/edit"
                params={{ studentId: props.studentId }}
                className="text-primary underline"
              >
                {t('profile.fix')}
              </Link>
              {t('profile.thenBack')}
            </p>
          </Card>
        ) : null}
      </div>

      <aside className="flex flex-col gap-6">
        <Card padded>
          <h2 className="text-h2">{t('serial.title')}</h2>
          <p className="mt-2 text-h2" data-testid="next-serial">
            {nextSerial(kind, props.year, props.latest)}
          </p>
          <p className="mt-2 text-text-secondary">{t('serial.help')}</p>
          <p className="mt-3 border-t border-border-subtle pt-3 text-caption">
            {t('serial.issuedThisYear', {
              count: props.issuedCount,
              n: formatNumber(props.issuedCount, region),
              year: formatNumber(props.year, region).replace(/[,٬]/g, ''),
            })}
          </p>
        </Card>

        {props.bulk ? (
          <Card padded>
            <div className="flex items-start gap-2">
              <UsersIcon className="mt-1 size-5" aria-hidden />
              <div>
                <h2 className="text-h2">{t('bulk.title')}</h2>
                <p className="mt-1 text-text-secondary">{t('bulk.help')}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              aria-pressed={props.bulk.enabled}
              loading={props.bulk.loading}
              onClick={props.bulk.onToggle}
            >
              {props.bulk.enabled
                ? t('bulk.single', { name: props.studentName })
                : t('bulk.action', { className: props.bulk.className })}
            </Button>
            {props.bulk.enabled && !props.bulk.loading ? (
              <p
                role={props.bulk.tooMany ? 'alert' : 'status'}
                className="mt-2 text-text-secondary"
              >
                {props.bulk.tooMany
                  ? t('bulk.tooMany')
                  : t('bulk.count', {
                      count: props.bulk.count,
                      n: formatNumber(props.bulk.count, region),
                    })}
              </p>
            ) : null}
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
