import { ApiError } from '@biddaloy/ui/api';
import {
  AuthLayout,
  Button,
  passwordTooLong,
  SetPasswordForm,
  weakPasswordRules,
} from '@biddaloy/ui/components';
import { useCockpitResetPassword } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Link2Off } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { GuestStatus } from './-guest-status';

export const Route = createFileRoute('/sign-in/reset')({
  validateSearch: z.object({ token: z.string().max(200).optional().catch(undefined) }),
  component: ResetPage,
});

/** Reads `?token=`, asks for a new password twice, then sends the owner to sign-in (no auto sign-in). */
function ResetPage() {
  const { t } = useTranslation('cockpit');
  const { token: urlToken } = Route.useSearch();
  // Rule 13: keep the link secret in state and take it out of the address bar and history.
  const [token] = React.useState(urlToken);
  const [tooLongHere, setTooLongHere] = React.useState(false);
  const navigate = useNavigate();
  const reset = useCockpitResetPassword();
  React.useEffect(() => {
    if (urlToken) void navigate({ to: '/sign-in/reset', search: {}, replace: true });
  }, [urlToken, navigate]);

  const dead = !token || (reset.error instanceof ApiError && reset.error.statusCode === 401);
  if (dead) {
    return (
      <AuthLayout>
        <GuestStatus
          icon={Link2Off}
          tone="warning"
          title={t('reset.badLink')}
          explanation={t('reset.badLinkBody')}
        >
          <Button asChild className="min-h-11 w-full">
            <Link to={'/sign-in/forgot'}>{t('reset.newLink')}</Link>
          </Button>
        </GuestStatus>
      </AuthLayout>
    );
  }

  const weak = weakPasswordRules(reset.error);
  const long = tooLongHere || passwordTooLong(reset.error);
  return (
    <AuthLayout>
      <SetPasswordForm
        heading={t('reset.title')}
        subtext={t('reset.body')}
        submitLabel={t('reset.submit')}
        audience="staff"
        loading={reset.isPending}
        failedRules={weak}
        tooLong={long}
        error={
          reset.isError && !weak && !long
            ? { message: t('reset.errors.generic'), tone: 'alert' }
            : null
        }
        onSubmit={(newPassword) => {
          // Rule 9: bcrypt reads 72 bytes; Bangla letters are 3 bytes each.
          const over = new TextEncoder().encode(newPassword).length > 72;
          setTooLongHere(over);
          if (over) return;
          reset.mutate(
            { token, newPassword },
            {
              onSuccess: () => void navigate({ to: '/sign-in', search: { reset: '1' } as never }),
            },
          );
        }}
      />
    </AuthLayout>
  );
}
