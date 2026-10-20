import { NoticeBar } from '@biddaloy/ui';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

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
        <Link to="/settings" search={{ section: 'billing' }} className="underline">
          {t('readOnly.buy')}
        </Link>
      </NoticeBar>
    </div>
  );
}
