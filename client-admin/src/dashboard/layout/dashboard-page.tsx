/**
 * [169.2-10] `/dashboard`: header, briefing, the active role's widget grid.
 * Role default + saved layout -> `resolveLayout`; a failed prefs read just
 * shows the role default. `customize` (from `?customize=1`) swaps the grid for customise mode (2-11).
 */
import { ROLE_DEFAULT_LAYOUTS, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { EmptyState, Skeleton } from '@biddaloy/ui/components';
import { hasPermission } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import { SlidersHorizontalIcon } from 'lucide-react';
import * as React from 'react';

import { BriefingSlot } from './briefing-slot';
import { CustomiseMode } from './customise/customise-mode';
import { DashboardGrid } from './dashboard-grid';
import { resolveLayout } from './resolve-layout';
import { useDashboardPrefs } from './use-dashboard-prefs';

/** Shaped like the page so nothing jumps when it lands. */
export function DashboardSkeleton() {
  return (
    <PageContainer>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

export function DashboardPage({ customize = false }: { customize?: boolean }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const region = useTenantRegionConfig();
  const { role, pref, isLoading } = useDashboardPrefs();
  const today = React.useMemo(() => new Date(), []);

  const { visible } = React.useMemo(
    () =>
      role
        ? resolveLayout({
            role,
            pref,
            catalogue: WIDGET_CATALOGUE,
            defaults: ROLE_DEFAULT_LAYOUTS,
            can: (p) => hasPermission(role, p),
          })
        : { visible: [], hidden: [] },
    [role, pref],
  );
  const openCustomise = () => void navigate({ to: '/dashboard', search: { customize: 1 } });
  const closeCustomise = () => void navigate({ to: '/dashboard', search: {} });

  if (isLoading) return <DashboardSkeleton />;

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title={t('page.title')}
          subtitle={`${formatWeekday(today, region)}, ${formatDate(today, region)}`}
          actions={
            customize
              ? []
              : [
                  {
                    id: 'customise',
                    label: t('page.customise'),
                    icon: <SlidersHorizontalIcon aria-hidden="true" />,
                    onClick: openCustomise,
                    keepOnPhone: true,
                  },
                ]
          }
        />
        {customize && role ? (
          <CustomiseMode role={role} onDone={closeCustomise} />
        ) : (
          <>
            <BriefingSlot />
            {visible.length === 0 ? (
              <EmptyState
                title={t('states.allHidden.title')}
                explanation={t('states.allHidden.explanation')}
                action={{ label: t('states.allHidden.action'), onClick: openCustomise }}
              />
            ) : (
              <DashboardGrid visible={visible} />
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
