import {
  APPLICATION_TYPES,
  ApplicationType,
  ApplicationAddressee,
  type ApplicationStep,
} from '@biddaloy/shared';
import { Card, ChoiceCards, MultiCombobox } from '@biddaloy/ui/components';
import { useApplicationAddressees, useApplicationTagOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { StaffCombobox } from './subject-card';

export interface TagChoice {
  /** `user:<id>` or `role:<ROLE>`. */
  value: string;
  label: string;
  description?: string;
}

export interface AddresseeState {
  addressee: ApplicationAddressee | '';
  userId: string;
  tags: TagChoice[];
}

export const EMPTY_ADDRESSEE: AddresseeState = { addressee: '', userId: '', tags: [] };

export function addresseeError(type: ApplicationType, s: AddresseeState): string | undefined {
  if (type !== ApplicationType.GENERAL) return undefined;
  if (!s.addressee) return 'required';
  if (s.addressee === ApplicationAddressee.STAFF_USER && !s.userId) return 'staffRequired';
  return undefined;
}

function stepKey(step: ApplicationStep): string {
  return step.kind === 'PERMISSION'
    ? `PERMISSION_${step.permission}`
    : step.kind === 'ROLES'
      ? `ROLES_${step.roles[0]}`
      : step.kind;
}

/** GENERAL picks its addressee (D12, D16, D38); typed types have a fixed approval chain (D13). */
export function AddresseeStep({
  type,
  studentId,
  state,
  onChange,
  showErrors,
}: {
  type: ApplicationType;
  studentId: string | undefined;
  state: AddresseeState;
  onChange: (patch: Partial<AddresseeState>) => void;
  showErrors: boolean;
}) {
  const { t } = useTranslation('applicationsNew');
  const { t: tApp } = useTranslation('applications');
  const { t: tDetail } = useTranslation('applicationsDetail');
  const [q, setQ] = React.useState('');
  const tagOptions = useApplicationTagOptions(q).data;
  const known = React.useRef(new Map<string, TagChoice>());
  const list: TagChoice[] = [
    ...(tagOptions?.users ?? []).map((u) => ({
      value: `user:${u.id}`,
      label: u.full_name,
      description: tDetail(`roles.${u.role}`),
    })),
    ...(tagOptions?.roles ?? []).map((r) => ({ value: `role:${r}`, label: tDetail(`roles.${r}`) })),
  ];
  for (const o of list) known.current.set(o.value, o);

  const addressees = useApplicationAddressees(studentId);
  const err = addresseeError(type, state);

  return (
    <div className="flex flex-col gap-4">
      <Card padded className="flex flex-col gap-3">
        {type === ApplicationType.GENERAL ? (
          <>
            {addressees.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('subject.loadError')}
              </p>
            )}
            <ChoiceCards
              label={t('addressee.choose')}
              value={state.addressee || undefined}
              onValueChange={(v) => onChange({ addressee: v as ApplicationAddressee, userId: '' })}
              options={(addressees.data ?? []).map((o) => ({
                value: o.addressee,
                title: tApp(`addressees.${o.addressee}`),
                ...(o.user ? { description: o.user.full_name } : {}),
              }))}
            />
            {state.addressee === ApplicationAddressee.STAFF_USER && (
              <StaffCombobox
                value={state.userId}
                onChange={(userId) => onChange({ userId })}
                label={t('addressee.staff')}
                {...(showErrors && err ? { describedBy: 'new-app-addressee-error' } : {})}
              />
            )}
            {showErrors && err && (
              <p
                id="new-app-addressee-error"
                role="alert"
                className="text-caption text-destructive"
              >
                {t(`addressee.${err}`)}
              </p>
            )}
          </>
        ) : (
          <TypedLine type={type} />
        )}
      </Card>
      <Card padded className="flex flex-col gap-2">
        <h2 className="text-h3">{t('addressee.tags')}</h2>
        <MultiCombobox
          aria-label={t('addressee.tags')}
          placeholder={t('addressee.tagsPlaceholder')}
          options={list}
          value={state.tags.map((x) => x.value)}
          onValueChange={(values) =>
            onChange({ tags: values.flatMap((v) => known.current.get(v) ?? []) })
          }
          selectedOptions={state.tags}
          // The list is fetched per typed text; the combobox keeps its own copy of the text.
          onInput={(e) => setQ(e.currentTarget.value)}
        />
        <p className="text-caption text-text-secondary">{t('addressee.tagsHelp')}</p>
      </Card>
    </div>
  );
}

function TypedLine({ type }: { type: ApplicationType }) {
  const { t } = useTranslation('applicationsNew');
  const { t: tApp } = useTranslation('applications');
  const steps = APPLICATION_TYPES[type].steps;
  const labels = steps.map((s) => tApp(`steps.${stepKey(s)}`, { name: '' }));
  const last = labels[labels.length - 1] ?? tApp('addressees.OFFICE');
  return (
    <>
      <h2 className="text-h3">{t('addressee.fixed', { title: last })}</h2>
      <p className="text-text-secondary">{t('addressee.route', { route: labels.join(' → ') })}</p>
    </>
  );
}

/** For the preview summary and the submit body. */
export function tagInputs(tags: TagChoice[]) {
  return tags.map((x) =>
    x.value.startsWith('user:') ? { user_id: x.value.slice(5) } : { role: x.value.slice(5) },
  );
}
