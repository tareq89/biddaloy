/**
 * [169.2-10] One card's safety net (D15): an error boundary plus Suspense.
 * A crash shows ErrorState with Retry that remounts only this card.
 * TENANT_SUSPENDED is re-thrown to the route's error screen.
 */
import type { WidgetSize } from '@biddaloy/shared';
import { isTenantSuspendedError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

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

export function WidgetSlot({ size, children }: { size: WidgetSize; children: React.ReactNode }) {
  const { t } = useTranslation('dashboard');
  return (
    <Boundary
      fallback={(reset) => (
        <ErrorState message={t('states.error')} retryLabel={t('states.retry')} onRetry={reset} />
      )}
    >
      <React.Suspense
        fallback={
          <div data-slot="widget-skeleton" className={SKELETON_HEIGHT[size]}>
            <Skeleton className="size-full rounded-lg" />
          </div>
        }
      >
        {children}
      </React.Suspense>
    </Boundary>
  );
}
