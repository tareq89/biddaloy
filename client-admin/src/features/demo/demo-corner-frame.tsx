import { DemoRibbon } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { ReactNode } from 'react';

import { useDemoMode } from './use-demo-mode';

/**
 * Wraps a shell so the demo ribbon has a `relative` ancestor to sit in. The wrapper is always
 * rendered: `GET /demo/roles` resolves after the shell's first paint, and swapping a fragment for
 * a div at that moment would remount the whole shell (an open dialog, typed input, all lost).
 */
export function DemoCornerFrame({ children }: { children: ReactNode }) {
  const { enabled } = useDemoMode();
  return (
    <div className="relative">
      {enabled && <LabelledRibbon />}
      {children}
    </div>
  );
}

/** Only mounted in the demo: a normal school's shell must not wait on the `demo` translations. */
function LabelledRibbon() {
  const { t } = useTranslation('demo');
  return <DemoRibbon label={t('ribbonLabel')} />;
}
