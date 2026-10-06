import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type * as React from 'react';

/**
 * The guided steps' own Back / primary row (the wizard frame's footer is not theirs to drive).
 * Inside a `<form>`, pass `submit` instead of `onPrimary` so Enter submits it.
 */
export function StepNav({
  onBack,
  onPrimary,
  submit = false,
  primaryLabel,
  busy = false,
  quiet = false,
}: {
  onBack: () => void;
  onPrimary?: () => void;
  submit?: boolean;
  primaryLabel?: React.ReactNode;
  busy?: boolean;
  /** A ghost primary, for when the step's content has its own filled one. */
  quiet?: boolean;
}) {
  const { t } = useTranslation('onboardingSetup');
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 md:flex-row md:justify-end">
      <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
        {t('footer.back')}
      </Button>
      <Button
        type={submit ? 'submit' : 'button'}
        onClick={onPrimary}
        loading={busy}
        {...(quiet ? { variant: 'ghost' as const } : {})}
      >
        {primaryLabel ?? t('footer.next')}
      </Button>
    </div>
  );
}
