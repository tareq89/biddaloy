import { Button, NoticeBar } from '@biddaloy/ui';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ExternalLink, Inbox } from 'lucide-react';
import * as React from 'react';

import { runtimeConfig } from '../../runtime-config';

const STORAGE_KEY = 'test-inbox-notice';

function readCollapsed(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    sessionStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Private window or blocked storage: the bar just comes back on the next screen.
  }
}

/** Link target for every "open the test inbox" control: a new tab, no opener. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Environment word: `demo` / `staging` by name, anything else is a plain test site (D28). */
function environmentKey(sentryEnvironment: string): 'demo' | 'staging' | 'other' {
  return sentryEnvironment === 'demo' || sentryEnvironment === 'staging'
    ? sentryEnvironment
    : 'other';
}

/** One help-text line with the inbox link, for the sign-in and forgot-password screens (D14). */
export function TestInboxHint({ className }: { className?: string }) {
  const { messageSinkUrl } = runtimeConfig();
  const { t } = useTranslation('auth');
  const { t: tDemo } = useTranslation('demo');
  if (!messageSinkUrl) return null;
  return (
    <p className={className ?? 'text-caption text-text-secondary'}>
      {t('help.testInbox')}{' '}
      <a href={messageSinkUrl} {...NEW_TAB} className="font-medium text-primary underline">
        {tDemo('testInbox.open')}
      </a>
    </p>
  );
}

/**
 * Thin bar above every shell on demo, staging and dev (empty `messageSinkUrl` on prod renders
 * nothing). Says messages are not really sent and opens the test inbox in a new tab; collapses to
 * a pill (state in sessionStorage) so it never costs a returning visitor screen space.
 */
export function TestEnvironmentNotice() {
  const { messageSinkUrl, sentryEnvironment } = runtimeConfig();
  const { t } = useTranslation('demo');
  const [collapsed, setCollapsed] = React.useState(readCollapsed);

  if (!messageSinkUrl) return null;

  const setState = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  if (collapsed) {
    return (
      <a
        href={messageSinkUrl}
        {...NEW_TAB}
        aria-label={t('testInbox.expand')}
        title={t('testInbox.expand')}
        className="absolute top-1 right-16 z-40 inline-flex size-11 items-center justify-center rounded-full bg-status-partial-bg text-status-partial-fg shadow-sm md:right-24 print:hidden"
      >
        <Inbox aria-hidden="true" className="size-4" />
      </a>
    );
  }

  const environment = t(`testInbox.environment.${environmentKey(sentryEnvironment)}`);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape is a shortcut; the Hide button is the accessible control
    <div
      className="print:hidden"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setState(true);
      }}
    >
      <NoticeBar tone={sentryEnvironment === 'staging' ? 'warning' : 'info'} icon={Inbox}>
        {/* NoticeBar truncates its text and hides `action` on phone, so the whole message, link and
            hide button go in the (wrapping) children: two lines on a phone, one on desktop. */}
        <span className="flex flex-wrap items-center gap-x-3 whitespace-normal">
          <span>{t('testInbox.bar', { environment })}</span>
          <a
            href={messageSinkUrl}
            {...NEW_TAB}
            className="inline-flex min-h-11 items-center gap-1 font-medium underline"
          >
            {t('testInbox.open')}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setState(true)}>
            {t('testInbox.collapse')}
          </Button>
        </span>
      </NoticeBar>
    </div>
  );
}
