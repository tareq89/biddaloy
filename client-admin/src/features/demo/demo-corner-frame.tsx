import { DemoRibbon } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
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

/** "2026-10-29" in the UI language; anything unparsable is shown as given. */
function formatBadgeDate(iso: string, language: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/**
 * [88 U5, D9] Red DEV / STAGING band in the top-right corner. Own markup because the shared
 * `DemoRibbon` hard-codes "DEMO". Nothing on prod (empty `envBadge`); the demo ribbon wins.
 */
function EnvRibbon() {
  const { i18n } = useTranslation();
  const { envBadge, envBadgeDate } = runtimeConfig();
  if (!envBadge) return null;
  const text =
    envBadge === 'STAGING' && envBadgeDate
      ? `STAGING · ${formatBadgeDate(envBadgeDate, i18n.language)}`
      : envBadge;
  return (
    // eslint-disable-next-line logical-properties/no-physical-direction-classes -- physical top-right corner in every locale, like DemoRibbon
    <div className="pointer-events-none absolute top-0 right-0 z-40 print:hidden">
      <span
        role="note"
        className="block bg-destructive px-3 py-0.5 text-caption font-bold tracking-widest whitespace-nowrap text-destructive-foreground md:text-label"
      >
        {text}
      </span>
    </div>
  );
}
