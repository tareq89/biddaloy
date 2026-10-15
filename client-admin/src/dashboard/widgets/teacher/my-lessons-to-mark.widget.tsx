/**
 * [8.10.7.7.05] `my-lessons-to-mark` widget: full / compact / tile (D16).
 * One primary action (P5): open the marking list at the oldest unmarked day.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_LESSONS_TO_MARK;

export type MyLessonsToMarkDto = components['schemas']['LessonsToMarkDto'];

const K = widgetKey;
/** Phone shows at most 3 rows (P-mobile); desktop shows what the server sent (5). */
const PHONE_ROWS = 3;

function useMyLessonsToMark() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-lessons-to-mark'],
    queryFn: async () =>
      (await apiClient.get<MyLessonsToMarkDto>('/dashboard/widgets/my-lessons-to-mark')).data,
    ...dashboardQueryOptions,
  });
}

export interface MyLessonsToMarkViewProps {
  data?: MyLessonsToMarkDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function MyLessonsToMarkView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MyLessonsToMarkViewProps) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);

  const title = tw('title');
  const full = variant === 'full';
  const count = data?.to_mark ?? 0;
  const done = !!data && count === 0;
  const subject = (i: MyLessonsToMarkDto['items'][number]) =>
    (locale === 'bn' && i.subject_name_bn) || i.subject_name_en;

  if (variant === 'tile' && data && !done) {
    return (
      <StatTile
        label={tw('compactTitle')}
        value={formatNumber(count, region)}
        {...(data.oldest_planned_on
          ? { note: tw('since', { date: formatDate(data.oldest_planned_on, region) }) }
          : {})}
      />
    );
  }

  const body =
    data && full && !done ? (
      <ul className="flex flex-col gap-2">
        {data.items.map((i, idx) => (
          <li
            key={`${i.planned_on}-${i.class_name}-${i.section_name}-${i.subject_name_en}-${idx}`}
            className={idx >= PHONE_ROWS ? 'hidden sm:flex' : 'flex'}
          >
            <span className="flex flex-col">
              <span>
                {i.class_name} {i.section_name} · {subject(i)}
              </span>
              <span className="text-caption text-text-secondary">
                {formatDate(i.planned_on, region)}
                {i.lesson_title ? ` · ${i.lesson_title}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !done
        ? { value: formatNumber(count, region), unit: tw('value', { count }) }
        : {})}
      {...(done ? { summary: tw('allMarked') } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data && !done ? (
          <Button asChild className="min-h-11">
            <Link
              to="/routines/my"
              search={data.oldest_planned_on ? { date: data.oldest_planned_on } : {}}
            >
              {tw('action')}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function MyLessonsToMarkWidget({ variant }: WidgetProps) {
  const q = useMyLessonsToMark();
  return (
    <MyLessonsToMarkView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
