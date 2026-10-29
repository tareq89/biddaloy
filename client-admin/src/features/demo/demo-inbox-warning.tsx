import { NoticeBar } from '@biddaloy/ui';
import { useTranslation } from '@biddaloy/ui/i18n';

import { runtimeConfig } from '../../runtime-config';

import { useDemoMode } from './use-demo-mode';

/**
 * Red warning above the phone / email field on sign-up and OTP sign-in in the public demo: the test
 * inbox is open to everyone, so no real contact belongs there (Epic 88 D4). Renders nothing
 * outside the demo; the check runs before `useTranslation` so a normal school never loads `demo`.
 */
export function DemoInboxWarning({ className }: { className?: string }) {
  const { enabled } = useDemoMode();
  return enabled ? <DemoInboxWarningBar className={className} /> : null;
}

function DemoInboxWarningBar({ className }: { className?: string | undefined }) {
  const { t } = useTranslation('demo');
  const { messageSinkUrl } = runtimeConfig();
  return (
    <div className={className}>
      <NoticeBar tone="danger">
        <span className="flex flex-wrap items-center gap-x-3 whitespace-normal">
          <span>{t('inboxWarning')}</span>
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
