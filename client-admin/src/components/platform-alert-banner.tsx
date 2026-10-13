import { NoticeBar } from '@biddaloy/ui';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';

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
