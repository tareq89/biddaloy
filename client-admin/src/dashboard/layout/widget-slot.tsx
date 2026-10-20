/**
 * [169.2-10] One card's safety net (D15): an error boundary plus Suspense.
 * A crash shows ErrorState with Retry that remounts only this card.
 * TENANT_SUSPENDED is re-thrown to the route's error screen.
 */
import type { DashboardWidgetKey, WidgetSize } from '@biddaloy/shared';
import { isTenantSuspendedError } from '@biddaloy/ui/api';
import { CachedDataNotice, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { WIDGET_COMPONENTS } from '../widgets/registry';

import { installDashboardFreshness } from './offline-freshness';

installDashboardFreshness();

const SKELETON_HEIGHT: Record<WidgetSize, string> = { S: 'h-40', M: 'h-48', L: 'h-64' };

class Boundary extends React.Component<
  { fallback: (reset: () => void) => React.ReactNode; children: React.ReactNode },
  { failed: boolean; error: unknown }
> {
  override state: { failed: boolean; error: unknown } = { failed: false, error: null };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }
  override render() {
    // A suspended school is page-wide, not one card's problem: let the route's
    // trial-ended screen take it (the query client throws it for this reason).
    if (this.state.failed && isTenantSuspendedError(this.state.error)) throw this.state.error;
    return this.state.failed
      ? this.props.fallback(() => this.setState({ failed: false, error: null }))
      : this.props.children;
  }
}

/** The grid passes no key, so find it from the child's registry component. */
function keyOf(children: React.ReactNode): DashboardWidgetKey | undefined {
  const type = React.isValidElement(children) ? children.type : undefined;
  return [...WIDGET_COMPONENTS].find(([, c]) => c === type)?.[0];
}

export function WidgetSlot({
  size,
  widgetKey,
  children,
}: {
  size: WidgetSize;
  widgetKey?: DashboardWidgetKey;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('dashboard');
  const key = widgetKey ?? keyOf(children);
  return (
    <>
      {key && <CachedDataNotice queryKey={['dashboard', 'widget', key]} />}
      <Boundary
        fallback={(reset) => (
          <ErrorState message={t('states.error')} retryLabel={t('states.retry')} onRetry={reset} />
        )}
      >
        <React.Suspense
          fallback={
            <div data-slot="widget-skeleton" className={SKELETON_HEIGHT[size]}>
              {/* The skeleton's only text: a phone tile's toggle is labelled by this slot. */}
              {key && (
                <span className="sr-only">
                  {t('states.loading', { title: t(`widgets.${key}.title`) })}
                </span>
              )}
              <Skeleton className="size-full rounded-lg" />
            </div>
          }
        >
          {children}
        </React.Suspense>
      </Boundary>
    </>
  );
}
