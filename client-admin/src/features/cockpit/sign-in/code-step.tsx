import { Button, CodeField } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useFocusFirst } from './use-focus-first';

export interface CodeStepProps {
  /** The authenticator code (6 digits) or, in recovery mode, the 16 characters without dashes. */
  onSubmit: (code: string) => void;
  loading?: boolean;
  error?: string | undefined;
  onStartAgain: () => void;
}

/** Step 2: authenticator code, or a recovery code after the link is used. Enter submits. */
export function CodeStep({ onSubmit, loading = false, error, onStartAgain }: CodeStepProps) {
  const { t } = useTranslation('cockpit');
  const [recovery, setRecovery] = React.useState(false);
  const [code, setCode] = React.useState('');
  const id = recovery ? 'cockpit-recovery' : 'cockpit-code';
  const full = code.length === (recovery ? 16 : 6);
  useFocusFirst(id);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (full) onSubmit(code);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('signIn.code.title')}</h2>
      <CodeField
        key={id}
        id={id}
        variant={recovery ? 'recovery' : 'totp'}
        label={recovery ? t('signIn.code.recoveryLabel') : t('signIn.code.label')}
        hint={recovery ? t('signIn.code.recoveryHint') : t('signIn.code.hint')}
        value={code}
        onValueChange={setCode}
        {...(error ? { error } : {})}
      />
      <Button
        type="button"
        variant="link"
        className="min-h-11 self-start px-0"
        onClick={() => {
          setRecovery(!recovery);
          setCode('');
        }}
      >
        {recovery ? t('signIn.code.useApp') : t('signIn.code.useRecovery')}
      </Button>
      <Button type="submit" className="min-h-11 w-full" disabled={loading || !full}>
        {loading ? t('signIn.working') : t('signIn.signIn')}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onStartAgain}>
        {t('signIn.startAgain')}
      </Button>
      <Help />
    </form>
  );
}

/** The two help.* answers, native `<details>` so they work by keyboard and need no index. */
function Help() {
  const { t } = useTranslation('cockpit');
  return (
    <div className="flex flex-col gap-2 text-sm text-text-secondary">
      {(['whyTwoSteps', 'whatIsRecoveryCode'] as const).map((key) => (
        <details key={key}>
          <summary className="min-h-11 cursor-pointer py-2">{t(`help.${key}.title`)}</summary>
          <p>{t(`help.${key}.body`)}</p>
        </details>
      ))}
    </div>
  );
}
