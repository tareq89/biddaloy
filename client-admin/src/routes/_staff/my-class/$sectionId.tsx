/**
 * [47.4.2] One homeroom section at a glance (D6/D15): phone-first single
 * column — the attendance button first, then six independent cards.
 * A section the caller is not a CLASS/ASSISTANT teacher of is a 404, same as
 * an id that does not exist.
 */
import { Button, ErrorState, RoutePending } from '@biddaloy/ui/components';
import { myClassSectionsQueryOptions, useMyClassSections } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import {
  AbsenteesCard,
  DuesCard,
  FlagsCard,
  HomeworkCard,
  ResultsCard,
  RosterCard,
  todayIso,
} from './-cards';

export const Route = createFileRoute('/_staff/my-class/$sectionId')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myClassSectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('myClass', 'nav'),
    ]),
  pendingComponent: () => <RoutePending variant="detail" label="Loading" />,
  component: MyClassSectionPage,
});

function MyClassSectionPage() {
  const { sectionId } = Route.useParams();
  const { t } = useTranslation('myClass');
  const query = useMyClassSections();
  const attendanceRef = React.useRef<HTMLAnchorElement>(null);
  const section = query.data?.find((s) => s.section_id === sectionId);

  // First focus: the one thing a class teacher does here every morning.
  // Runs once the section resolves (the button only exists then).
  React.useEffect(() => {
    if (section) attendanceRef.current?.focus();
  }, [section]);

  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState
          message={t('cardError')}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  if (query.isPending) return <RoutePending variant="detail" label="Loading" />;
  if (!section) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw notFound();
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">
        {t('pageTitle', { section: `${section.class_name}-${section.section_name}` })}
      </h1>
      <Button asChild size="lg">
        <Link
          ref={attendanceRef}
          to="/attendance/$sectionId"
          params={{ sectionId }}
          search={{ date: todayIso() }}
        >
          {t('takeAttendance')}
        </Link>
      </Button>
      <AbsenteesCard sectionId={sectionId} />
      <FlagsCard sectionId={sectionId} />
      <DuesCard sectionId={sectionId} />
      <HomeworkCard sectionId={sectionId} />
      <ResultsCard sectionId={sectionId} classId={section.class_id} />
      <RosterCard sectionId={sectionId} />
    </div>
  );
}
