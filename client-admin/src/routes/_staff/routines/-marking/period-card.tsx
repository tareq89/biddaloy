/** [66.3.01] One period: its planned lesson and the ✓ / ◐ / ✕ report (D3, D8, D35). */
import { Button, LessonStatusGroup, StatusBadge } from '@biddaloy/ui/components';
import { useUpsertLessonDelivery, type LessonDeliveryStatus } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { NotTaughtDialog } from './not-taught-dialog';
import { periodState, type MarkingPeriod } from './types';

export interface PeriodCardProps {
  period: MarkingPeriod;
  date: string;
  sectionLabel: string;
  subjectLabel: string;
  roomLabel: string | null;
  coveringLabel?: string | undefined;
  canMakePlan: boolean;
}

export function PeriodCard({
  period,
  date,
  sectionLabel,
  subjectLabel,
  roomLabel,
  coveringLabel,
  canMakePlan,
}: PeriodCardProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const upsert = useUpsertLessonDelivery();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const groupRef = React.useRef<HTMLDivElement>(null);
  const state = periodState(period);
  const { delivery, lesson } = period;
  const periodText = t('agenda.periodLabel', { sequence: period.sequence });
  const timeText = `${formatTime(period.starts_at, config)} – ${formatTime(period.ends_at, config)}`;

  const base = {
    section_id: period.section.id,
    subject_id: period.subject.id,
    date,
    period_slot_id: period.period_slot_id,
  };
  // While saving show the picked value; on error `variables` is ignored and the
  // group falls back to the saved one.
  const value: LessonDeliveryStatus | null = upsert.isPending
    ? (upsert.variables?.status ?? null)
    : (delivery?.status ?? null);

  function pick(status: LessonDeliveryStatus) {
    if (status === 'NOT_TAUGHT') return setDialogOpen(true);
    upsert.mutate({ ...base, status });
  }

  const badge =
    state === 'auto' ? (
      <StatusBadge
        tone="neutral"
        label={t(
          delivery?.reason === 'ON_LEAVE'
            ? 'marking.badge.autoLeave'
            : 'marking.badge.autoCancelled',
        )}
      />
    ) : state === 'noPlan' ? (
      <StatusBadge tone="neutral" label={t('marking.badge.noPlan')} />
    ) : state === 'reported' ? (
      <StatusBadge tone="success" label={t('marking.badge.reported')} />
    ) : (
      <StatusBadge tone="warning" label={t('marking.badge.pending')} />
    );

  const lessonNote =
    state === 'auto' || delivery?.status === 'NOT_TAUGHT'
      ? `${t('marking.lessonMoved')} — ${t('marking.lessonMovedBody')}`
      : delivery?.status === 'PARTLY'
        ? t('marking.sameLesson')
        : null;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label text-text-secondary">
          {t('marking.periodLine', { period: periodText, time: timeText })}
        </p>
        {badge}
      </div>
      <div className="flex flex-col gap-1">
        <p>
          <span className="font-semibold">{sectionLabel}</span> ·{' '}
          <span className="font-semibold">{subjectLabel}</span>
          {roomLabel ? ` · ${roomLabel}` : ''}
        </p>
        {coveringLabel && <StatusBadge tone="info" label={coveringLabel} />}
      </div>

      {period.plan_id && (
        <div className="flex flex-col gap-1 border-s-4 border-border-functional ps-3">
          <p className="text-caption text-text-secondary">{t('marking.todaysLesson')}</p>
          <p className="font-semibold">
            {t('marking.lessonLine', { no: lesson.number, title: lesson.title })}
          </p>
          <p className="text-caption text-text-secondary">
            {t('marking.lessonPeriods', { done: lesson.part, total: lesson.of })}
          </p>
          {lessonNote && <p className="text-caption text-text-secondary">{lessonNote}</p>}
        </div>
      )}

      {state === 'auto' && (
        <p className="text-body">
          {t(
            delivery?.reason === 'ON_LEAVE' ? 'marking.autoLeaveBody' : 'marking.autoCancelledBody',
          )}
        </p>
      )}

      {state === 'noPlan' && (
        <>
          <p className="text-body">{t('marking.noPlanBody', { subject: subjectLabel })}</p>
          {canMakePlan && (
            <Button variant="outline" className="h-14 w-full md:h-11 md:w-fit" asChild>
              <Link to="/academics/syllabus" search={{ tab: 'plans', new: 1 } as never}>
                {t('marking.makePlan')}
              </Link>
            </Button>
          )}
        </>
      )}

      {(state === 'left' || state === 'reported') && (
        <div className="flex flex-col gap-2">
          <div ref={groupRef} aria-busy={upsert.isPending}>
            <LessonStatusGroup
              value={value}
              onChange={pick}
              labels={{
                TAUGHT: t('marking.status.taught'),
                PARTLY: t('marking.status.partly'),
                NOT_TAUGHT: t('marking.status.notTaught'),
              }}
              groupLabel={t('marking.statusGroupLabel', {
                period: periodText,
                section: sectionLabel,
                subject: subjectLabel,
              })}
              disabled={upsert.isPending || !period.can_mark}
            />
          </div>
          {upsert.isError && (
            <p role="alert" className="text-caption text-status-overdue-fg">
              {t('marking.saveFailed')}
            </p>
          )}
          {!period.can_mark ? (
            <p className="text-caption text-text-secondary">{t('marking.windowClosed')}</p>
          ) : delivery ? (
            <p className="text-caption text-text-secondary">
              {t('marking.reportedAt', { time: formatTime(delivery.recorded_at, config) })}
            </p>
          ) : null}
        </div>
      )}

      <NotTaughtDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        section={sectionLabel}
        subject={subjectLabel}
        period={periodText}
        lessonTitle={lesson.title}
        pending={upsert.isPending}
        onCloseFocus={() => {
          const radios = groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
          radios?.[radios.length - 1]?.focus(); // ✕ is last
        }}
        onSubmit={(input) =>
          upsert.mutate(
            {
              ...base,
              status: 'NOT_TAUGHT',
              reason: input.reason,
              ...(input.note ? { note: input.note } : {}),
            },
            { onSuccess: () => setDialogOpen(false) },
          )
        }
      />
    </article>
  );
}
