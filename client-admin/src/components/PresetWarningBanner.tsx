/**
 * [35.4.6] Warns that preset-origin settings affect future results. Renders
 * only when the school has an applied curriculum preset (D15); nothing while
 * loading, on error, or for AVAILABLE / CUSTOM. Static, no dismiss.
 * Mounted by #1290 — not mounted anywhere yet.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

import { usePresetStatus } from '../pages/curriculum-preset/use-preset-status';

export function PresetWarningBanner({ className }: { className?: string }) {
  const { t } = useTranslation('presetWarning');
  const { data } = usePresetStatus();
  if (data?.state !== 'APPLIED') return null;
  return (
    <p
      role="note"
      className={`rounded-lg bg-status-due-bg p-3 text-sm text-status-due-fg${className ? ` ${className}` : ''}`}
    >
      {t('banner')}
    </p>
  );
}
