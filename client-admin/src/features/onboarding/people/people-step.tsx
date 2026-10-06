import { onboardingStatusQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';

import { PeopleCard } from './people-card';

export interface PeopleStepProps {
  /** The route owns the sample-file downloads; a missing handler hides its button. */
  onDownloadStudentSample?: () => void;
  onDownloadStaffSample?: () => void;
}

/**
 * [13.6.4] Wizard step 2, the `people` slot. Back / Next live in the wizard
 * frame's footer (its one filled button), so this body has none; "skip" is
 * that Next, and the quiet line says where to add people later.
 */
export function PeopleStep({ onDownloadStudentSample, onDownloadStaffSample }: PeopleStepProps) {
  const { t } = useTranslation('onboardingPeople');
  // Always refetch: coming back from an import page must show the new counts.
  const status = useQuery({ ...onboardingStatusQueryOptions(), refetchOnMount: 'always' });
  const counts = status.data?.counts;
  const limit = status.data?.trial?.seats.limit ?? null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('heading')}</h2>
      {status.data?.trial && limit !== null && (
        <p className="text-sm text-muted-foreground">{t('trialCap', { limit })}</p>
      )}
      <PeopleCard
        title={t('students.title')}
        count={t('students.added', { count: counts?.students ?? 0 })}
        byHand={{ to: '/students/new' }}
        excel={{ to: '/students/import' }}
        onDownloadSample={onDownloadStudentSample}
      />
      <PeopleCard
        title={t('staff.title')}
        count={t('staff.added', { count: counts?.staff ?? 0 })}
        note={t('staff.oneFile')}
        byHand={{ to: '/staff', search: { add: 1 } }}
        excel={{ to: '/staff/import' }}
        onDownloadSample={onDownloadStaffSample}
      />
      <p className="text-sm text-muted-foreground">{t('later')}</p>
    </div>
  );
}
