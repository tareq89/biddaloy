import { Button, Input } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { detectLoginIdentifier } from '@biddaloy/ui/utils';
import * as React from 'react';

import { useFocusFirst } from './use-focus-first';

export type CockpitIdentity = { email: string } | { phone: string };

export interface PasswordStepProps {
  onSubmit: (identity: CockpitIdentity, password: string) => void;
  loading?: boolean;
  /** One sentence for every failure before both proofs pass (Rule 18). */
  error?: string | undefined;
  /** The route owns the destination (a router `<Link>`), same as `SignInForm.secondaryAction`. */
  secondaryAction?: React.ReactNode;
}

/** Step 1: who and the password. Enter submits. */
export function PasswordStep({
  onSubmit,
  loading = false,
  error,
  secondaryAction,
}: PasswordStepProps) {
  const { t } = useTranslation('cockpit');
  const region = useRegionConfig();
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [local, setLocal] = React.useState<{
    identifier?: string | undefined;
    password?: string | undefined;
  }>({});
  useFocusFirst('cockpit-identifier');

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const found = detectLoginIdentifier(identifier, region);
    const next = {
      identifier: found.kind === 'invalid' ? t('signIn.errors.identifierRequired') : undefined,
      password: password === '' ? t('signIn.errors.passwordRequired') : undefined,
    };
    setLocal(next);
    if (found.kind === 'invalid' || password === '') return;
    onSubmit(found.kind === 'email' ? { email: found.email } : { phone: found.phone }, password);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="cockpit-identifier" className="text-sm font-medium">
          {t('signIn.identifierLabel')}
        </label>
        <Input
          id="cockpit-identifier"
          autoComplete="username"
          value={identifier}
          aria-invalid={local.identifier ? true : undefined}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        {local.identifier && (
          <p role="alert" className="text-caption text-destructive">
            {local.identifier}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cockpit-password" className="text-sm font-medium">
          {t('signIn.passwordLabel')}
        </label>
        <Input
          id="cockpit-password"
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={local.password || error ? true : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {(local.password ?? error) && (
          <p role="alert" className="text-caption text-destructive">
            {local.password ?? error}
          </p>
        )}
      </div>
      <Button type="submit" className="min-h-11 w-full" disabled={loading}>
        {loading ? t('signIn.working') : t('signIn.next')}
      </Button>
      {secondaryAction}
    </form>
  );
}
