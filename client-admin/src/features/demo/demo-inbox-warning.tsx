import { NoticeBar } from '@biddaloy/ui';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { runtimeConfig } from '../../runtime-config';

import { useDemoMode } from './use-demo-mode';

/**
 * Red warning above the phone / email field on sign-up and OTP sign-in in the public demo: the test
 * inbox is open to everyone, so no real contact belongs there (Epic 88 D4). Renders nothing
 * outside the demo; the check runs before `useTranslation` so a normal school never loads `demo`.
 * The runtime flag (`demoMode`, served with the page) shows it at once; `/demo/roles` is only the
 * fallback, so a slow or failed roles request can never hide it (#3266).
 */
export function DemoInboxWarning({ className }: { className?: string }) {
  const { enabled } = useDemoMode();
  return enabled || runtimeConfig().demoMode ? (
    <DemoInboxWarningBar className={className} />
  ) : null;
}

const FALLBACK =
  'This is a public test inbox that anyone can read. Do not enter a real phone number or email.';

function DemoInboxWarningBar({ className }: { className?: string | undefined }) {
  // Without the roles request the `demo` texts may not be loaded yet: never suspend, and show the
  // English text until they arrive.
  const { t, i18n } = useTranslation('demo', { useSuspense: false });
  React.useEffect(() => {
    void i18n.loadNamespaces('demo');
  }, [i18n]);
  const { messageSinkUrl } = runtimeConfig();
  return (
    <div className={className}>
      <NoticeBar tone="danger">
        <span className="flex flex-wrap items-center gap-x-3 whitespace-normal">
          <span>{t('inboxWarning', { defaultValue: FALLBACK })}</span>
          {messageSinkUrl ? (
            <a
              href={messageSinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-medium underline"
            >
              {t('testInbox.open')}
            </a>
          ) : null}
        </span>
      </NoticeBar>
    </div>
  );
}
