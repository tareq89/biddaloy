/**
 * Academics → Syllabus. Line tabs: Topics (the [22.4.3] class/subject topic
 * list, `-topics-tab.tsx`) and Study plans ([66.3.g1-01], `-plans-tab.tsx`).
 * The tab lives in `?tab=`; Topics is the default and the plain URL.
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending, Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, type PageAction } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Upload } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { CreatePlanWizard } from './-create-plan/create-plan-wizard';
import { LibraryTab, type LibraryDialog } from './-library/library-tab';
import { PlansPageHeader, PlansTab } from './-plans-tab';
import { TopicsTab, useTopicsSelection } from './-topics-tab';

const TABS = ['topics', 'plans', 'library'] as const;
type SyllabusTab = (typeof TABS)[number];

const optionalString = z.string().optional().catch(undefined);

const syllabusSearchSchema = z.object({
  tab: z.enum(TABS).optional().catch(undefined),
  class_id: optionalString,
  subject_id: optionalString,
  // Plans tab list state; `plan_` keeps the filters apart from the topics pickers.
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: optionalString,
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  plan_class: optionalString,
  plan_subject: optionalString,
  plan_term: optionalString,
  // `?behind=1` parses to a number, so accept both.
  behind: z.union([z.string(), z.number()]).transform(String).optional().catch(undefined),
  q: optionalString,
  tpl_grade: optionalString,
  tpl_subject: optionalString,
  // One-shot flags: `?new=1` opens the create wizard (TanStack parses it to a number);
  // `?template=<id>` opens it on that library template.
  new: z.union([z.string(), z.number()]).optional().catch(undefined),
  template: optionalString,
  step: optionalString,
});

export const Route = createFileRoute('/_staff/academics/syllabus/')({
  validateSearch: syllabusSearchSchema,
  loader: () => loadRouteNamespaces('syllabus', 'studyPlans'),
  pendingComponent: SyllabusListPending,
  component: SyllabusPage,
});

function SyllabusPage() {
  const { t } = useTranslation('syllabus');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: SyllabusTab = search.tab ?? 'topics';
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);
  const [createOpen, setCreateOpen] = React.useState(false);
  const { hasSelection } = useTopicsSelection(search);

  const canManageTemplates = useHasPermission(Permission.STUDY_PLAN_TEMPLATE_MANAGE);
  const [libraryDialog, setLibraryDialog] = React.useState<LibraryDialog>(null);
  const { t: tPlans } = useTranslation('studyPlans');
  const wizardOpen = tab === 'plans' && search.new !== undefined && canManage;
  // A user without SYLLABUS_MANAGE gets no wizard and no stray `new`.
  React.useEffect(() => {
    if (search.new === undefined || canManage) return;
    void navigate({
      search: (prev) => ({ ...prev, new: undefined, template: undefined, step: undefined }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per flag
  }, [search.new, canManage]);

  const openWizard = () => void navigate({ search: (prev) => ({ ...prev, tab: 'plans', new: 1 }) });
  const closeWizard = () =>
    void navigate({
      search: (prev) => ({ ...prev, new: undefined, template: undefined, step: undefined }),
      replace: true,
    });

  function pick(key: 'class_id' | 'subject_id', value: string) {
    void navigate({ search: (prev) => ({ ...prev, [key]: value }), replace: true });
  }

  const topicsActions: PageAction[] = [
    {
      id: 'add',
      label: t('list.addTopic'),
      icon: <Plus />,
      priority: 'primary',
      allowed: canManage && hasSelection,
      onClick: () => setCreateOpen(true),
    },
  ];

  return (
    <PageContainer>
      {tab === 'library' ? (
        <PageHeader
          title={t('list.title')}
          subtitle={tPlans('library.subtitle')}
          actions={
            canManageTemplates
              ? [
                  {
                    id: 'addTemplate',
                    label: tPlans('library.add'),
                    icon: <Plus />,
                    priority: 'primary',
                    onClick: () => setLibraryDialog('add'),
                  },
                  {
                    id: 'addTemplateCsv',
                    label: tPlans('library.addFromCsv'),
                    icon: <Upload />,
                    priority: 'secondary',
                    onClick: () => setLibraryDialog('csv'),
                  },
                ]
              : []
          }
        />
      ) : tab === 'plans' ? (
        <PlansPageHeader title={t('list.title')} onCreate={canManage ? openWizard : undefined} />
      ) : (
        <PageHeader title={t('list.title')} subtitle={t('list.subtitle')} actions={topicsActions} />
      )}
      <Tabs
        value={tab}
        onValueChange={(next) =>
          // Filters belong to a tab — drop them when switching. Topics is the plain URL.
          void navigate({ search: { tab: next === 'topics' ? undefined : (next as SyllabusTab) } })
        }
      >
        <TabsList variant="line" aria-label={t('tabs.label')}>
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="topics" className="space-y-4 pt-4 md:pt-6">
          <TopicsTab
            search={search}
            onPick={pick}
            createOpen={createOpen}
            setCreateOpen={setCreateOpen}
          />
        </TabsContent>
        <TabsContent value="library" className="space-y-4 pt-4 md:pt-6">
          <LibraryTab
            addDialog={libraryDialog}
            onAddDialog={setLibraryDialog}
            onCopy={
              canManage
                ? (template) =>
                    void navigate({
                      search: (prev) => ({ ...prev, tab: 'plans', new: 1, template }),
                    })
                : undefined
            }
          />
        </TabsContent>
        <TabsContent value="plans" className="space-y-4 pt-4 md:pt-6">
          <PlansTab onCreate={canManage ? openWizard : undefined} />
        </TabsContent>
      </Tabs>
      {wizardOpen && (
        <CreatePlanWizard
          onCloseFallback={closeWizard}
          template={search.template}
          prefill={{
            classId: search.plan_class,
            subjectId: search.plan_subject,
            termId: search.plan_term,
          }}
        />
      )}
    </PageContainer>
  );
}

function SyllabusListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
