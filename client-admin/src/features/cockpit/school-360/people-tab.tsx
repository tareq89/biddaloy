/**
 * #3820 School 360, "People" tab: the existing admins card (passed as children, unchanged) first,
 * then a card with the count of people per role from the overview hook.
 */
import { Button, Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useSchoolOverview } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import type * as React from 'react';

export interface PeopleTabProps {
  schoolId: string;
  /** The admins card. */
  children?: React.ReactNode;
  onLoginAs?: () => void;
  onStuckAdmin?: () => void;
}

export function PeopleTab({ schoolId, children, onLoginAs, onStuckAdmin }: PeopleTabProps) {
  const { t } = useTranslation('school360');
  const { t: tRole } = useTranslation('loginAs');
  const config = useRegionConfig();
  const overview = useSchoolOverview(schoolId);
  const people = overview.data?.peopleByRole ?? [];

  return (
    <div className="space-y-4">
      {children}
      <Card className="space-y-3 p-4 md:p-5">
        <h2 className="text-h3 font-semibold">{t('people.countsTitle')}</h2>
        {overview.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : overview.isError ? (
          <ErrorState
            message={t('people.loadError')}
            retryLabel={t('people.retry')}
            onRetry={() => void overview.refetch()}
          />
        ) : people.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('people.countsEmpty')}</p>
        ) : (
          <ul className="space-y-1">
            {people.map((p) => (
              <li key={p.role}>
                {tRole(`roles.${p.role}`, { defaultValue: p.role })}:{' '}
                {formatNumber(p.count, config)}
              </li>
            ))}
          </ul>
        )}
        {(onLoginAs || onStuckAdmin) && (
          <div className="flex flex-wrap gap-2">
            {onLoginAs && (
              <Button variant="outline" onClick={onLoginAs}>
                {t('people.loginAs')}
              </Button>
            )}
            {onStuckAdmin && (
              <Button variant="outline" onClick={onStuckAdmin}>
                {t('people.stuckAdmin')}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
