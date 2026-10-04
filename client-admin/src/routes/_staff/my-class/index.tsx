/**
 * [47.4.2] "Which of my homeroom sections?" — `GET /my-class/sections`
 * (current-year CLASS_TEACHER / ASSISTANT_CLASS_TEACHER rows, D12/D26).
 *
 * - 0 sections: empty state (D14).
 * - 1 section: redirect straight to its page, or to the attendance register
 *   when the palette sent `?then=attendance` (D13).
 * - 2+: one card per section with a role badge.
 *
 * The redirect lives in the loader so the picker never flashes.
 */
import { EmptyState, ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { myClassSectionsQueryOptions, useMyClassSections } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

const searchSchema = z.object({
  then: z.enum(['attendance']).optional().catch(undefined),
});

// Local getters — `toISOString()` is UTC and would link to yesterday's
// register for a teacher in Asia/Dhaka before 06:00 (same note as
// `attendance/index.tsx`).
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const Route = createFileRoute('/_staff/my-class/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ then: search.then }),
  loader: async ({ context: { queryClient }, deps }) => {
    const [sections] = await Promise.all([
      queryClient.ensureQueryData(myClassSectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('myClass', 'nav'),
    ]);
    const only = sections?.length === 1 ? sections[0] : undefined;
    if (only) {
      if (deps.then === 'attendance') {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: '/attendance/$sectionId',
          params: { sectionId: only.section_id },
          search: { date: todayIso() },
        });
      }
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/my-class/$sectionId', params: { sectionId: only.section_id } });
    }
  },
  pendingComponent: () => <RoutePending variant="list" label="Loading" />,
  component: MyClassPickerPage,
});

function MyClassPickerPage() {
  const { t } = useTranslation('myClass');
  const query = useMyClassSections();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

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

  const sections = query.data ?? [];

  if (sections.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title={t('title')} explanation={t('empty')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <ul className="flex flex-col gap-2">
        {sections.map((section) => (
          <li key={section.section_id}>
            <Link
              to="/my-class/$sectionId"
              params={{ sectionId: section.section_id }}
              className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card px-4 py-2 no-underline hover:bg-muted"
            >
              <span className="font-medium">
                {section.class_name} {section.section_name}
              </span>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t(`roles.${section.assignment_type}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
