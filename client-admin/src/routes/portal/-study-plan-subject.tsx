import { ProgressBar } from '@biddaloy/ui/components';
import type { FamilyStudyPlansResponse } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';

export type FamilySubjectPlan = FamilyStudyPlansResponse['subjects'][number];
export type FamilyExamSyllabus = FamilySubjectPlan['exam_syllabus'][number];

/** "today, 12 May" / "yesterday, 11 May" / "tomorrow, 13 May" / "14 May". */
export function useRelativeDate() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  return (date: string): string => {
    const label = formatDate(date, config);
    const diffDays = Math.round(
      (parseServerDate(date).getTime() - parseServerDate(toIsoDate(new Date())).getTime()) /
        86_400_000,
    );
    if (diffDays === 0) return t('syllabus.plan.today', { date: label });
    if (diffDays === 1) return t('syllabus.plan.tomorrow', { date: label });
    if (diffDays === -1) return t('syllabus.plan.yesterday', { date: label });
    return label;
  };
}

/** The date by which the exam's remaining lessons should be taught, or null
 * when it cannot be said honestly (the lesson is past the 5 returned and the
 * exam syllabus stops before the plan's end). */
function examFinishDate(plan: FamilySubjectPlan, exam: FamilyExamSyllabus): string | null {
  const last = plan.next.find((lesson) => lesson.number === exam.lessons_in_syllabus);
  if (last?.expected_date) return last.expected_date;
  return exam.lessons_in_syllabus === plan.lessons_total ? plan.expected_finish_date : null;
}

/** One subject's expanded body: where now, why behind, exam boxes, next 5. */
export function StudyPlanSubject({ plan }: { plan: FamilySubjectPlan }) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const relativeDate = useRelativeDate();
  const n = (value: number) => formatNumber(value, config);

  return (
    <div className="space-y-4">
      {plan.teacher_names.length > 0 && (
        <p className="text-text-secondary">
          {t('syllabus.plan.teacher', { names: plan.teacher_names.join(', ') })}
        </p>
      )}

      <section aria-labelledby={`where-${plan.plan_id}`}>
        <h3 id={`where-${plan.plan_id}`} className="text-caption text-text-secondary">
          {t('syllabus.plan.whereNow')}
        </h3>
        {plan.last_taught ? (
          <p className="font-medium">
            {t('syllabus.plan.lastTaughtLesson', {
              no: n(plan.last_taught.number),
              title: plan.last_taught.title,
            })}{' '}
            <span className="font-normal text-text-secondary">
              · {t('syllabus.plan.lastTaught', { when: relativeDate(plan.last_taught.date) })}
            </span>
          </p>
        ) : (
          <p className="font-medium">{t('syllabus.plan.notStarted')}</p>
        )}
        <div className="mt-2">
          <ProgressBar
            done={plan.lessons_done}
            total={plan.lessons_total}
            label={t('syllabus.plan.lessonsOf', {
              done: n(plan.lessons_done),
              total: n(plan.lessons_total),
            })}
          />
        </div>
        {plan.expected_finish_date && (
          <p className="mt-1 text-caption text-text-secondary">
            {t('syllabus.plan.planFinish', { date: formatDate(plan.expected_finish_date, config) })}
          </p>
        )}
      </section>

      {plan.lessons_behind >= 1 && (
        <section aria-labelledby={`why-${plan.plan_id}`}>
          <h3 id={`why-${plan.plan_id}`} className="text-caption text-text-secondary">
            {t('syllabus.plan.whyBehind')}
          </h3>
          <p>
            {t('syllabus.plan.whyBehindBody', {
              lessons: n(plan.lessons_behind),
              periods: n(plan.periods_behind),
            })}
          </p>
        </section>
      )}

      {plan.exam_syllabus.map((exam) => {
        const remaining = exam.lessons_in_syllabus - exam.lessons_taught;
        const finish = remaining > 0 ? examFinishDate(plan, exam) : null;
        return (
          <div key={exam.exam_id} className="rounded-lg border border-border-subtle p-3">
            <p className="font-medium">
              {t('syllabus.plan.examBox', {
                exam: exam.exam_name,
                total: n(exam.lessons_in_syllabus),
                taught: n(exam.lessons_taught),
              })}
            </p>
            <div className="mt-2">
              <ProgressBar
                done={exam.lessons_taught}
                total={exam.lessons_in_syllabus}
                label={t('syllabus.plan.lessonsOf', {
                  done: n(exam.lessons_taught),
                  total: n(exam.lessons_in_syllabus),
                })}
              />
            </div>
            {finish && (
              <p className="mt-1 text-caption text-text-secondary">
                {t('syllabus.plan.examRemaining', {
                  count: n(remaining),
                  date: formatDate(finish, config),
                })}
              </p>
            )}
          </div>
        );
      })}

      {plan.next.length > 0 && (
        <section aria-labelledby={`next-${plan.plan_id}`}>
          <h3 id={`next-${plan.plan_id}`} className="text-h3">
            {t('syllabus.plan.nextFive')}
          </h3>
          <ol className="mt-2 divide-y divide-border-subtle border-t border-border-subtle">
            {plan.next.slice(0, 5).map((lesson) => (
              <li key={lesson.number} className="flex min-h-11 items-start gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-text-secondary"
                >
                  {n(lesson.number)}
                </span>
                <span className="min-w-0 flex-1">
                  {lesson.title}
                  {lesson.expected_date && (
                    <span className="text-text-secondary">
                      {' '}
                      · {relativeDate(lesson.expected_date)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-caption text-text-secondary">{t('syllabus.plan.estimateNote')}</p>
        </section>
      )}
    </div>
  );
}
