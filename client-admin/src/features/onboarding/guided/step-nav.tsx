import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type * as React from 'react';

/** The guided steps' own Back / primary row (the wizard frame's footer is not theirs to drive). */
export function StepNav({
  onBack,
  onPrimary,
  primaryLabel,
  busy = false,
}: {
  onBack: () => void;
  onPrimary: () => void;
  primaryLabel?: React.ReactNode;
  busy?: boolean;
}) {
  const { t } = useTranslation('onboardingSetup');
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 md:flex-row md:justify-end">
      <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
        {t('footer.back')}
      </Button>
      <Button type="button" onClick={onPrimary} loading={busy}>
        {primaryLabel ?? t('footer.next')}
      </Button>
    </div>
  );
}
