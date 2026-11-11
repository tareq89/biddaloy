import { AuthLayout, Button, Input } from '@biddaloy/ui/components';
import { useCockpitForgotPassword } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import * as React from 'react';

import { useFocusFirst } from '../features/cockpit/sign-in/use-focus-first';

import { GuestStatus } from './-guest-status';

export const Route = createFileRoute('/sign-in/forgot')({ component: ForgotPage });

/** Asks only for the email and shows one confirmation for any input (Rule 18). */
function ForgotPage() {
  const { t } = useTranslation('cockpit');
  const forgot = useCockpitForgotPassword();
  const [email, setEmail] = React.useState('');
  const [empty, setEmpty] = React.useState(false);
  useFocusFirst('cockpit-forgot-email');

  if (forgot.isSuccess) {
    return (
      <AuthLayout>
        <GuestStatus icon={MailCheck} tone="success" title={t('forgot.sent')}>
          <Button asChild className="min-h-11 w-full">
            <Link to={'/sign-in'}>{t('forgot.back')}</Link>
          </Button>
        </GuestStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const identifier = email.trim();
          setEmpty(identifier === '');
          if (identifier !== '') forgot.mutate({ identifier });
        }}
      >
        <h1 className="text-xl font-semibold">{t('forgot.title')}</h1>
        <p className="text-sm text-text-secondary">{t('forgot.body')}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="cockpit-forgot-email" className="text-sm font-medium">
            {t('forgot.emailLabel')}
          </label>
          <Input
            id="cockpit-forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {(empty || forgot.isError) && (
            <p role="alert" className="text-caption text-destructive">
              {empty ? t('forgot.errors.emailRequired') : t('forgot.errors.generic')}
            </p>
          )}
        </div>
        <Button type="submit" className="min-h-11 w-full" disabled={forgot.isPending}>
          {forgot.isPending ? t('signIn.working') : t('forgot.send')}
        </Button>
        <Button asChild variant="ghost" className="min-h-11 w-full text-primary">
          <Link to={'/sign-in'}>{t('forgot.back')}</Link>
        </Button>
      </form>
    </AuthLayout>
  );
}
