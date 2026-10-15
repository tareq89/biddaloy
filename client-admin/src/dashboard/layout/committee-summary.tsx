/**
 * [8.10.7.5.06] The committee's briefing banner (D47): one sentence built on the client from the
 * two committee aggregates the tiles already load (same query keys, no extra request). COMMITTEE
 * has no server briefing. A failed or empty query just drops its clause; no clause, no banner.
 */
import { BriefingLine } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { LightbulbIcon } from 'lucide-react';

import { useCommitteeAttendance } from '../widgets/committee/committee-attendance.widget';
import { useCommitteeFinance } from '../widgets/committee/committee-finance.widget';
import { buildCommitteeSummary } from '../widgets/committee/committee-summary';

export function CommitteeSummary() {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const attendance = useCommitteeAttendance();
  const finance = useCommitteeFinance();

  if (attendance.isPending || finance.isPending) return <BriefingLine headline="" loading />;

  const sentence = buildCommitteeSummary(attendance.data, finance.data, t, region);
  if (!sentence) return null;

  const updatedAt = Math.min(
    ...[attendance, finance].filter((q) => q.data && q.dataUpdatedAt).map((q) => q.dataUpdatedAt),
  );
  const minutes = Number.isFinite(updatedAt) ? Math.floor((Date.now() - updatedAt) / 60_000) : null;
  const caption =
    minutes === null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });

  return (
    <BriefingLine
      icon={<LightbulbIcon aria-hidden="true" className="size-5" />}
      headline={sentence}
      {...(caption ? { caption } : {})}
    />
  );
}
