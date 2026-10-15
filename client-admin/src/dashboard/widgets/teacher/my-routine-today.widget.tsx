/**
 * [169.4-1883] `my-routine-today` widget: full / compact (not a phone tile).
 * The hook feeds the pure `MyRoutineTodayView`, which the stories render.
 * Done / now / next come from the tenant clock, never the browser zone.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, formatTime, tenantNowHhmm } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_ROUTINE_TODAY;

export type MyRoutineTodayDto = components['schemas']['MyRoutineTodayDto'];

const K = widgetKey;

function useMyRoutineToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-routine-today'],
    queryFn: async () =>
      (await apiClient.get<MyRoutineTodayDto>('/dashboard/widgets/my-routine-today')).data,
    ...dashboardQueryOptions,
  });
}

export interface MyRoutineTodayViewProps {
  data?: MyRoutineTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** Test / story seam: the tenant-clock `HH:MM`. Defaults to now. */
  nowHhmm?: string;
}

const cn = (...c: (string | false)[]) => c.filter(Boolean).join(' ');
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function MyRoutineTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  nowHhmm,
}: MyRoutineTodayViewProps) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const subject = (en: string | null, bn: string | null) => (locale === 'bn' && bn) || en || bn;
  const linkClass = 'text-primary underline';

  const now = nowHhmm ?? tenantNowHhmm(region);
  const nowMin = minutes(now);

  const periods = data?.periods ?? [];
  const state = periods.map((p) =>
    minutes(p.ends_at) <= nowMin ? 'done' : minutes(p.starts_at) <= nowMin ? 'now' : 'later',
  );
  const done = state.filter((s) => s === 'done').length;
  const nextIdx = periods.findIndex((p, i) => state[i] === 'later' && !p.cancelled);
  const next = periods[nextIdx];
  const closed = data?.is_working_day === false;
  const empty = !!data && !closed && periods.length === 0;

  let summary: string | undefined;
  if (closed) summary = tw('closedToday');
  else if (next) {
    summary = [
      tw('next', {
        minutes: formatNumber(minutes(next.starts_at) - nowMin, region),
        room: next.room_label ?? `${next.class_name} ${next.section_name}`,
      }),
      next.is_homeroom
        ? tw('ownSection', { section: `${next.class_name} ${next.section_name}` })
        : '',
    ]
      .join(' ')
      .trim();
  } else if (data?.next_day) {
    const d = data.next_day;
    summary = tw('nextDayFirst', {
      date: formatDate(d.date, region),
      time: formatTime(d.starts_at, region),
      label: `${d.class_name} ${d.section_name}, ${subject(d.subject_name_en, d.subject_name_bn) ?? ''}`,
    });
  }

  const full = variant === 'full';
  const unitText = tw('value', { done: formatNumber(done, region) });
  const cardSummary =
    (full ? summary : [unitText, summary].filter(Boolean).join(' · ')) || undefined;
  const title = tw('title');
  const link = (
    <Link to="/routines/my" className={linkClass}>
      {tw('link')}
    </Link>
  );

  const dividerAt = state.findIndex((s) => s !== 'done');
  const divider = (
    <li key="now" className="border-t-2 border-primary pt-1 text-caption text-primary">
      {tw('nowLine', { time: formatTime(now, region) })}
    </li>
  );
  const body =
    data && !closed && !empty ? (
      full ? (
        <ol className="flex flex-col gap-2">
          {periods.map((p, i) => (
            <React.Fragment key={`${p.starts_at}-${p.section_id}`}>
              {i === (dividerAt === -1 ? periods.length : dividerAt) ? divider : null}
              <li
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1',
                  state[i] === 'done' && 'text-text-secondary',
                  // phone: only "now" and "next" rows
                  state[i] !== 'now' && i !== nextIdx && 'max-md:hidden',
                )}
              >
                <span className="tabular-nums">
                  {formatTime(p.starts_at, region)} – {formatTime(p.ends_at, region)}
                </span>
                <span>
                  {p.class_name} {p.section_name} · {subject(p.subject_name_en, p.subject_name_bn)}
                  {p.room_label ? ` · ${p.room_label}` : ''}
                </span>
                {state[i] === 'now' ? <StatusBadge tone="info" label={tw('labelNow')} /> : null}
                {i === nextIdx ? <StatusBadge tone="warning" label={tw('labelNext')} /> : null}
                {p.covering ? <StatusBadge tone="info" label={tw('covering')} /> : null}
                {p.cancelled ? <StatusBadge tone="neutral" label={tw('cancelled')} /> : null}
              </li>
            </React.Fragment>
          ))}
          {dividerAt === -1 ? divider : null}
        </ol>
      ) : (
        <div className="flex gap-1" aria-hidden="true">
          {state.map((s, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                s === 'done' ? 'bg-primary' : s === 'now' ? 'bg-primary/60' : 'bg-muted',
              )}
            />
          ))}
        </div>
      )
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !closed && !empty
        ? { value: formatNumber(periods.length, region), unit: unitText }
        : {})}
      {...(cardSummary ? { summary: cardSummary } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason'), action: link } } : {})}
      footer={data && !closed && !empty ? link : undefined}
    >
      {body}
    </WidgetCard>
  );
}

export default function MyRoutineTodayWidget({ variant }: WidgetProps) {
  const q = useMyRoutineToday();
  return (
    <MyRoutineTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
