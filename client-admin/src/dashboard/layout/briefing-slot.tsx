/**
 * [169.2-10] The briefing band. The data is the Epic 67 attention summary
 * (`GET /attention/summary`, D1), the same one the shell bar reads, so it
 * costs no extra request. Hidden while it fails: the page must not break.
 * Its one filled button opens the to-do list.
 */
import { BriefingLine, Button } from '@biddaloy/ui/components';
import { useAttentionSummary } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';

export function BriefingSlot() {
  const { t } = useTranslation('attention');
  const region = useTenantRegionConfig();
  const { data, isLoading } = useAttentionSummary();
  if (isLoading) return <BriefingLine headline="" loading />;
  if (!data) return null;

  const open = data.critical + data.warning + data.reminder;
  if (open === 0) return <BriefingLine headline={t('modal.empty')} />;

  const n = { format: (v: number) => formatNumber(v, region) };
  const parts = (['critical', 'warning', 'reminder'] as const)
    .filter((k) => data[k] > 0)
    .map((k) => t(`bar.${k}`, { count: data[k], n: n.format(data[k]) }));
  return (
    <BriefingLine
      icon={<BellIcon className="size-5" />}
      headline={parts.join(' · ')}
      {...(data.top ? { mostUrgent: t('bar.mostUrgent', { title: data.top.title }) } : {})}
      action={
        <Button asChild>
          <Link to="/notifications" search={{ tab: 'active' }}>
            {t('modal.seeAll', { n: n.format(open) })}
          </Link>
        </Button>
      }
    />
  );
}
