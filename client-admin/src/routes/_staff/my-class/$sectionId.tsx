/**
 * [47.4.2] One homeroom section at a glance (D6/D15): the attendance button
 * first, then six independent cards (one column on phone, three on desktop).
 * A section the caller is not a CLASS/ASSISTANT teacher of is a 404, same as
 * an id that does not exist.
 */
import { Button, ErrorState, RoutePending } from '@biddaloy/ui/components';
import { myClassSectionsQueryOptions, useMyClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ClipboardCheckIcon } from 'lucide-react';
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
  pendingComponent: SectionPending,
  component: MyClassSectionPage,
});

function SectionPending() {
  const { t } = useTranslation('myClass');
  return <RoutePending variant="detail" label={t('loading')} />;
}

function MyClassSectionPage() {
  const { sectionId } = Route.useParams();
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
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
      <PageContainer>
        <ErrorState
          message={t('sectionLoadError')}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }
  if (query.isPending) return <SectionPending />;
  if (!section) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw notFound();
  }

  return (
    <PageContainer>
      {/* Inline PageHeader markup: the primary is a router Link that must take
          focus on load, and PageAction has neither `to` nor a ref. */}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          {/* Same text as the crumb (`use-breadcrumbs.ts`): h1 = last crumb. */}
          <h1 className="text-h1">{`${section.class_name} – ${section.section_name}`}</h1>
          <p className="mt-0.5 truncate text-text-secondary">
            {t('subtitle', {
              role: t(`roles.${section.assignment_type}`),
              date: formatDate(new Date(), region),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild className="flex-1 md:flex-none">
            <Link
              ref={attendanceRef}
              to="/attendance/$sectionId"
              params={{ sectionId }}
              search={{ date: todayIso() }}
            >
              <ClipboardCheckIcon aria-hidden="true" />
              {t('takeAttendance')}
            </Link>
          </Button>
        </div>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
        <AbsenteesCard sectionId={sectionId} />
        <FlagsCard sectionId={sectionId} />
        <DuesCard sectionId={sectionId} />
        <HomeworkCard sectionId={sectionId} />
        <ResultsCard sectionId={sectionId} classId={section.class_id} />
        <RosterCard sectionId={sectionId} />
      </div>
    </PageContainer>
  );
}
