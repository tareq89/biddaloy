import { DemoRibbon } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import type { ReactNode } from 'react';

import { runtimeConfig } from '../../runtime-config';

import { TestEnvironmentNotice } from './test-environment-notice';
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
      {enabled ? <LabelledRibbon /> : <EnvRibbon />}
      {/* Staging has no ribbon but needs the bar, so it does not depend on `enabled`. */}
      <TestEnvironmentNotice />
      {children}
    </div>
  );
}

/** Only mounted in the demo: a normal school's shell must not wait on the `demo` translations. */
function LabelledRibbon() {
  const { t } = useTranslation('demo');
  return <DemoRibbon label={t('ribbonLabel')} />;
}

/** "2026-10-29" in the school's date style; anything the formatter cannot read is shown as given. */
function formatBadgeDate(iso: string, region: RegionConfig): string {
  const text = formatDate(iso, region);
  return text === '—' ? iso : text;
}

/**
 * [88 U5, D9] Red DEV / STAGING strip across the top. In flow, not a corner overlay: the text
 * ("STAGING · Oct 29, 2026") is wider than the header's reserved corner and would cover the user
 * menu and language switcher. Nothing on prod (empty `envBadge`); the demo ribbon wins.
 */
function EnvRibbon() {
  const region = useRegionConfig();
  const { envBadge, envBadgeDate } = runtimeConfig();
  if (!envBadge) return null;
  const text =
    envBadge === 'STAGING' && envBadgeDate
      ? `STAGING · ${formatBadgeDate(envBadgeDate, region)}`
      : envBadge;
  return (
    <div
      role="note"
      className="bg-destructive px-3 py-0.5 text-center text-caption font-bold tracking-widest text-destructive-foreground md:text-label print:hidden"
    >
      {text}
    </div>
  );
}
