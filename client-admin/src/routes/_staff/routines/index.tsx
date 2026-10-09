/**
 * [21.8.1] `/routines` — pick a class, then a section, then jump into that
 * section's grid builder at `/routines/$sectionId`. Same `useClasses` +
 * `useClassSections(classId)` shape as `attendance/register.tsx` — no
 * "all sections" endpoint exists. [31.4] The class lives in `?classId=` so
 * coming back from a builder keeps it; with no param the first class is used.
 */
import {
  DataTable,
  EmptyState,
  ErrorState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useClasses, useClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

type SectionRow = NonNullable<ReturnType<typeof useClassSections>['data']>[number];

const searchSchema = z.object({
  classId: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: RoutinesListPage,
});

function RoutinesListPage() {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const classesQuery = useClasses();
  const classes = classesQuery.data?.data ?? [];
  const classId = search.classId ?? classes[0]?.id;
  const className = classes.find((klass) => klass.id === classId)?.name ?? '';
  const sectionsQuery = useClassSections(classId);
  const sections = sectionsQuery.data ?? [];

  const header = <PageHeader title={t('builderList.title')} subtitle={t('builderList.subtitle')} />;

  if (classesQuery.isError || sectionsQuery.isError) {
    return (
      <PageContainer>
        {header}
        <ErrorState
          message={t('builderList.error')}
          onRetry={() => {
            void classesQuery.refetch();
            void sectionsQuery.refetch();
          }}
        />
      </PageContainer>
    );
  }

  if (!classesQuery.isPending && classes.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          title={t('builderList.noClassesTitle')}
          explanation={t('builderList.noClassesExplanation')}
          action={{
            label: t('builderList.goToClasses'),
            onClick: () => void navigate({ to: '/classes' }),
          }}
        />
      </PageContainer>
    );
  }

  const columns: DataTableColumn<SectionRow>[] = [
    {
      id: 'section',
      header: t('builderList.sectionColumn'),
      accessorFn: (section) => (
        <Link
          to="/routines/$sectionId"
          params={{ sectionId: section.id }}
          search={{ classId }}
          className="flex min-h-11 flex-col justify-center hover:text-primary md:min-h-0"
        >
          <span className="font-medium">
            {t('builderList.sectionName', { name: section.section_name })}
          </span>
          <span className="text-caption text-text-secondary md:hidden">
            {t('builderList.enrolledCount', {
              count: section.enrolled_count,
              formattedCount: formatNumber(section.enrolled_count, config),
            })}
          </span>
        </Link>
      ),
    },
    {
      id: 'students',
      header: t('builderList.studentsColumn'),
      align: 'end',
      card: 'hidden',
      accessorFn: (section) => formatNumber(section.enrolled_count, config),
    },
  ];

  return (
    <PageContainer>
      {header}
      <div className="md:w-72">
        <Label htmlFor="routines-class" className="mb-1 block">
          {t('builderList.classLabel')}
        </Label>
        <Select
          value={classId ?? ''}
          onValueChange={(id) => void navigate({ to: '.', search: { classId: id }, replace: true })}
        >
          <SelectTrigger id="routines-class" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {classes.map((klass) => (
              <SelectItem key={klass.id} value={klass.id}>
                {klass.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        tableId="routines-sections"
        caption={t('builderList.tableCaption', { className })}
        columns={columns}
        data={sections}
        getRowId={(section) => section.id}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={sections.length}
        loading={classesQuery.isPending || (!!classId && sectionsQuery.isPending)}
        rowActions={(section) => [
          {
            intent: 'edit',
            label: t('builderList.openAction'),
            to: `/routines/${section.id}?classId=${classId}`,
          },
        ]}
        emptyState={{
          title: t('builderList.emptyTitle'),
          explanation: t('builderList.emptyExplanation'),
          action: {
            label: t('builderList.openClassAction'),
            onClick: () =>
              void navigate({ to: '/classes/$classId', params: { classId: classId ?? '' } }),
          },
        }}
      />
    </PageContainer>
  );
}
