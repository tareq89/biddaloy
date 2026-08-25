import { useUser } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface MembershipsTabProps {
  userId: string;
}

/**
 * The active school's membership only — role plus member-since date. No
 * endpoint lists a user's memberships across schools, deliberately:
 * tenant isolation means this school's admin has no business seeing
 * where else a person works, and the note below says so out loud.
 */
export function MembershipsTab({ userId }: MembershipsTabProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const query = useUser(userId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(user) => (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <dt className="text-sm text-muted-foreground">
                {t('detail.memberships.columnRole')}
              </dt>
              <dd>
                {user.role !== null ? t(`roles.${user.role}`) : t('detail.profile.emptyValue')}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t('detail.memberships.columnJoined')}
              </dt>
              <dd>
                {/* Membership date, not account date — an account that
                    predates the membership would otherwise show the wrong
                    "member since". Falls back for older cached payloads. */}
                {formatDate(new Date(user.member_since ?? user.created_at), regionConfig)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">{t('detail.memberships.note')}</p>
        </div>
      )}
    </TabQueryState>
  );
}
