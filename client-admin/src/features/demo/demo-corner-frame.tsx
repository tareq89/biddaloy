import { DemoRibbon } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { ReactNode } from 'react';

import { useDemoMode } from './use-demo-mode';

/**
 * Wraps a shell so the demo ribbon has a `relative` ancestor to sit in. Outside the demo it
 * returns its children untouched, so the app renders exactly as before.
 */
export function DemoCornerFrame({ children }: { children: ReactNode }) {
  const { enabled } = useDemoMode();
  const { t } = useTranslation('demo');
  if (!enabled) return <>{children}</>;
  return (
    <div className="relative">
      <DemoRibbon label={t('ribbonLabel')} />
      {children}
    </div>
  );
}
