/**
 * [99.G4.03] `/welcome/support-access` — one step, shown once to a school admin
 * (and again when the text version changes). Skipping is not offered (D3).
 */
import { getActiveRole, isSupportSession } from '@biddaloy/ui/api';
import { AuthLayout, Button, Checkbox } from '@biddaloy/ui/components';
import { useConfirmSupportAccess, useSupportAccessSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { isSameAppRedirect } from '../same-app-redirect';

const searchSchema = z.object({
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

export const Route = createFileRoute('/welcome/support-access')({
  validateSearch: searchSchema,
  component: SupportWelcomePage,
});

export interface SupportWelcomeFormProps {
  onSave: (allowed: boolean) => void;
  saving?: boolean;
  failed?: boolean;
}

/** The card itself: ticked by default; Space toggles, Enter submits. */
export function SupportWelcomeForm({
  onSave,
  saving = false,
  failed = false,
}: SupportWelcomeFormProps) {
  const { t } = useTranslation('supportWelcome');
  const [allowed, setAllowed] = React.useState(true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) onSave(allowed);
      }}
    >
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-2 text-text-secondary">{t('why')}</p>
      <div className="mt-5 flex min-h-11 items-center gap-3">
        <Checkbox
          id="support-access-allowed"
          checked={allowed}
          disabled={saving}
          onCheckedChange={(v) => setAllowed(v === true)}
          // Radix swallows Enter on its checkbox button; D3 wants Enter to confirm.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.form?.requestSubmit();
          }}
        />
        <label htmlFor="support-access-allowed" className="font-medium">
          {t('checkbox')}
        </label>
      </div>
      <p className="mt-1 text-caption text-text-secondary">{t('later')}</p>
      {failed && (
        <p role="alert" className="mt-4 font-medium text-status-overdue-fg">
          {t('error')}
        </p>
      )}
      <Button type="submit" className="mt-5 h-11 w-full" disabled={saving}>
        {saving ? t('saving') : t('submit')}
      </Button>
    </form>
  );
}

function SupportWelcomePage() {
  const { t } = useTranslation('supportWelcome');
  const search = Route.useSearch();
  const navigate = useNavigate();
  const settings = useSupportAccessSettings();
  const confirm = useConfirmSupportAccess();
  const next = search.redirect ?? '/';

  // Only a school admin is ever sent here; anyone else who types the URL goes on.
  const allowedHere = getActiveRole() === 'ADMIN' && !isSupportSession();
  React.useEffect(() => {
    if (!allowedHere) void navigate({ to: next, replace: true });
  }, [allowedHere, navigate, next]);
  if (!allowedHere) return null;

  return (
    <AuthLayout>
      {settings.isError ? (
        <div role="alert">
          <p>{t('loadError')}</p>
          <Button
            type="button"
            className="mt-4 h-11 w-full"
            onClick={() => void settings.refetch()}
          >
            {t('retry')}
          </Button>
        </div>
      ) : !settings.data ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <SupportWelcomeForm
          saving={confirm.isPending}
          failed={confirm.isError}
          onSave={(allowed) =>
            confirm.mutate(
              { allowed, textVersion: settings.data.currentTextVersion },
              { onSuccess: () => void navigate({ to: next, replace: true }) },
            )
          }
        />
      )}
    </AuthLayout>
  );
}
