/**
 * Live password rules (D10, D21). Rows come from the shared `checkPassword`,
 * so the list is exactly what the server enforces. State is carried by icon
 * AND text (a hidden "done"/"not done" word), never by colour alone. Screen
 * readers hear one polite summary instead of a row per keystroke.
 */
import { checkPassword, type PasswordAudience } from '@biddaloy/shared';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { useFormField } from './form-field';

export interface PasswordChecklistProps {
  password: string;
  audience?: PasswordAudience;
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

export function PasswordChecklist({ password, audience = 'staff', id }: PasswordChecklistProps) {
  const { t } = useTranslation('auth');
  const rules = checkPassword(password, audience);
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
