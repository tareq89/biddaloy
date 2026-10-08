import { ApiError, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  studyPlanQueryOptions,
  useSaveStudyPlanLessons,
  type StudyPlanDetail,
  type StudyPlanLesson,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Every lesson change is one `PUT /study-plans/:id/lessons` with the whole
 * ordered list. The response is the new plan, so it goes straight into the
 * cache (no flash of the old order); `dropped_markers` get one info toast each.
 */
export function useSaveLessons(planId: string) {
  const { t } = useTranslation('studyPlans');
  const queryClient = useQueryClient();
  const mutation = useSaveStudyPlanLessons(planId);

  function save(
    lessons: StudyPlanLesson[],
    callbacks: { onSuccess?: () => void; onError?: () => void } = {},
  ) {
    const key = studyPlanQueryOptions(planId).queryKey;
    mutation.mutate(
      { lessons },
      {
        onSuccess: (data: StudyPlanDetail) => {
          const before = queryClient.getQueryData<StudyPlanDetail>(key);
          queryClient.setQueryData(key, data);
          for (const dropped of data.dropped_markers ?? []) {
            const exam = before?.exam_markers.find((m) => m.exam_id === dropped.exam_id)?.exam_name;
            notifyOutcome({
              tenantId: captureNotificationTenant(),
              variant: 'info',
              message: t('detail.markerDropped', { exam: exam ?? '' }),
            });
          }
          callbacks.onSuccess?.();
        },
        onError: (error) => {
          const outOfScope =
            error instanceof ApiError && error.details?.code === 'STUDY_PLAN_OUT_OF_SCOPE';
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'error',
            message: outOfScope ? t('detail.notYourPlan') : error.message,
          });
          callbacks.onError?.();
        },
      },
    );
  }

  return { save, isPending: mutation.isPending };
}
