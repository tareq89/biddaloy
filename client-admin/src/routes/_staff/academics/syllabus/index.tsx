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
import { Plus } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { PlansPageHeader, PlansTab } from './-plans-tab';
import { TopicsTab, useTopicsSelection } from './-topics-tab';

const TABS = ['topics', 'plans'] as const;
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
      {tab === 'plans' ? (
        <PlansPageHeader title={t('list.title')} />
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
        <TabsContent value="plans" className="space-y-4 pt-4 md:pt-6">
          <PlansTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function SyllabusListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
