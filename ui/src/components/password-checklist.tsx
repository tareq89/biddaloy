/**
 * Live password rules (D10, D21). Rows come from the shared `checkPassword`,
 * so the list is exactly what the server enforces. State is carried by icon
 * AND text (a hidden "done"/"not done" word), never by colour alone. Screen
 * readers hear one polite summary instead of a row per keystroke.
 */
import { checkPassword, type PasswordAudience, type PasswordRuleId } from '@biddaloy/shared';

import { ApiError } from '../api';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { useFormField } from './form-field';

export interface PasswordChecklistProps {
  password: string;
  audience?: PasswordAudience;
  /** Rules the server rejected (`PASSWORD_TOO_WEAK`); shown as not met. */
  failed?: PasswordRuleId[] | undefined;
  /** Ties the list to its input via `aria-describedby`. */
  id?: string;
}

export function RuleIcon({ ok }: { ok: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4 shrink-0">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d={ok ? 'M6.5 10.25l2.5 2.5 4.5-5' : 'M7 7l6 6M13 7l-6 6'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** `details.failed` of a 400 `PASSWORD_TOO_WEAK`, else `undefined`. */
export function weakPasswordRules(error: unknown): PasswordRuleId[] | undefined {
  if (!(error instanceof ApiError) || error.details?.code !== 'PASSWORD_TOO_WEAK') return undefined;
  return Array.isArray(error.details.failed)
    ? (error.details.failed as PasswordRuleId[])
    : undefined;
}

export function PasswordChecklist({
  password,
  audience = 'staff',
  failed,
  id,
}: PasswordChecklistProps) {
  const { t } = useTranslation('auth');
  const rules = checkPassword(password, audience).map((rule) => ({
    ...rule,
    ok: rule.ok && !failed?.includes(rule.id),
  }));
  const met = rules.filter((rule) => rule.ok).length;

  return (
    <div id={id} className="flex flex-col gap-1.5">
      <span className="sr-only" aria-live="polite">
        {t('passwordRules.summary', { met, total: rules.length })}
      </span>
      <ul className="flex flex-col gap-1">
        {rules.map(({ id: ruleId, ok }) => (
          <li
            key={ruleId}
            className={cn(
              'flex items-center gap-2 text-xs',
              ok ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className={ok ? 'text-status-paid-fg' : 'text-muted-foreground'}>
              <RuleIcon ok={ok} />
            </span>
            <span>{t(`passwordRules.${ruleId}`)}</span>
            <span className="sr-only">
              {ok ? t('passwordRules.met') : t('passwordRules.unmet')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inside a `FormItem`: becomes the input's `aria-describedby` target. */
export function FormPasswordChecklist(props: Omit<PasswordChecklistProps, 'id'>) {
  const { formDescriptionId } = useFormField();
  return <PasswordChecklist {...props} id={formDescriptionId} />;
}
