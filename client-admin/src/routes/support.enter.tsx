/**
 * [99.G4.01] `/support/enter#code=…` — the new tab Login as opens. Public
 * (see `__root.tsx`): no refresh call is made before it runs.
 */
import { AuthLayout, Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { enterSupportSession, takeFragmentCode } from '../features/support-access/support-session';

import { GuestStatus } from './-guest-status';

export const Route = createFileRoute('/support/enter')({
  component: SupportEnterPage,
});

function SupportEnterPage() {
  const { t } = useTranslation('supportBanner');
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice; the code is single use, so once only.
    if (started.current) return;
    started.current = true;
    const code = takeFragmentCode();
    if (!code) {
      setFailed(true);
      return;
    }
    enterSupportSession(code).then(
      () => void navigate({ to: '/', replace: true }),
      () => setFailed(true),
    );
  }, [navigate]);

  return (
    <AuthLayout>
      {failed ? (
        <GuestStatus
          icon={TriangleAlert}
          tone="danger"
          title={t('intake.failedTitle')}
          explanation={t('intake.failed')}
        >
          <Button type="button" onClick={() => window.close()}>
            {t('intake.closeTab')}
          </Button>
        </GuestStatus>
      ) : (
        <p role="status">{t('intake.opening')}</p>
      )}
    </AuthLayout>
  );
}
