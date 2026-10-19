import { NoticeBar } from '@biddaloy/ui';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatTime } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

import {
  usePlatformAlerts,
  type PlatformAlerts,
} from '../features/platform-alerts/use-platform-alerts';

type PlatformAlert = PlatformAlerts['alerts'][number];

/** Presentational half, so Storybook can show it without a query. */
export function PlatformAlertNotice({ alert }: { alert: PlatformAlert }) {
  const { t } = useTranslation('attention');
  const config = useRegionConfig();
  return (
    <div className="sticky top-[var(--app-header-h,0px)] z-20">
      <NoticeBar tone="danger">
        {t(`platformAlert.${alert.kind}`, { time: formatTime(alert.opened_at, config) })}
      </NoticeBar>
    </div>
  );
}

/**
 * [75.35] Red, non-dismissable bar for SUPER_ADMINs while a platform alert is
 * open (today: Redis down). Renders nothing when there is no alert, while
 * loading, or on a first-load error. `enabled` is false for every other role,
 * so no request is sent for them.
 */
export function PlatformAlertBanner({ enabled }: { enabled: boolean }) {
  const { data } = usePlatformAlerts(enabled);
  const alert = enabled ? data?.alerts[0] : undefined;
  return alert ? <PlatformAlertNotice alert={alert} /> : null;
}

/**
 * Epic 49 D9: shown to a school admin while the school is over its seats and read-only.
 * `until` is the end of the grace window (the billing summary, or `details.until` of a
 * TENANT_READ_ONLY 403). The admin layout mounts it.
 */
export function ReadOnlyNotice({ until }: { until: Date | string }) {
  const { t } = useTranslation('common');
  const config = useRegionConfig();
  return (
    <div className="sticky top-[var(--app-header-h,0px)] z-20">
      <NoticeBar tone="danger">
        {t('readOnly.notice', { date: formatDate(until, config) })}{' '}
        {/* ponytail: `as never` until the billing lane adds `billing` to the /settings section enum; drop the cast then. */}
        <Link to="/settings" search={{ section: 'billing' } as never} className="underline">
          {t('readOnly.buy')}
        </Link>
      </NoticeBar>
    </div>
  );
}
