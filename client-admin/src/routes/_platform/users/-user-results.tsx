import { Button, Card, EmptyState, StatusBadge } from '@biddaloy/ui/components';
import type { PlatformUserItem } from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { formatRelativeAge } from '@biddaloy/ui/utils';
import { LogInIcon, LogOutIcon } from 'lucide-react';

/** Mockup "Users": one card per person, a Login as button per school and role. Cards at 390. */
export type UserMembership = PlatformUserItem['memberships'][number];

export interface UserResultsProps {
  users: readonly PlatformUserItem[];
  loading: boolean;
  /** True when the search failed; the text is fixed and never echoes what was typed. */
  error: boolean;
  onRetry: () => void;
  onLoginAs: (user: PlatformUserItem, membership: UserMembership) => void;
  onLogout: (user: PlatformUserItem) => void;
}

export function UserResults({
  users,
  loading,
  error,
  onRetry,
  onLoginAs,
  onLogout,
}: UserResultsProps) {
  const { t } = useTranslation('platformUsers');
  const { t: tRole } = useTranslation('loginAs');
  const { locale } = useLocale();

  if (loading) return <p role="status">{t('resultsLabel')}…</p>;
  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-destructive">{t('error')}</p>
        <Button variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (users.length === 0) {
    return <EmptyState kind="no-results" title={t('empty')} explanation={t('emptyExplanation')} />;
  }

  return (
    <ul aria-label={t('resultsLabel')} className="space-y-3">
      {users.map((user) => {
        const noLogin = user.status === 'INACTIVE';
        return (
          <li key={user.userId}>
            <Card padded className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-h3">{user.fullName}</h2>
                {user.locked && <StatusBadge tone="warning" label={t('locked')} />}
                {noLogin && <StatusBadge tone="neutral" label={t('noLoginAccount')} />}
              </div>
              <p className="text-text-secondary">
                {[user.phoneMasked, user.emailMasked].filter(Boolean).join(' · ')}
              </p>
              <p className="text-text-secondary">
                {user.lastLoginAt
                  ? t('lastLogin', {
                      when: formatRelativeAge(Date.parse(user.lastLoginAt), locale),
                    })
                  : t('neverLoggedIn')}
              </p>
              {user.memberships.length === 0 ? (
                <p>{t('noSchools')}</p>
              ) : (
                <ul className="space-y-2">
                  {user.memberships.map((m) => {
                    const role = tRole(`roles.${m.role}`, { defaultValue: m.role });
                    return (
                      <li
                        key={m.memberId}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {m.schoolName} ({role})
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 md:min-h-8"
                          disabled={noLogin}
                          aria-label={t('loginAsFor', {
                            name: user.fullName,
                            school: m.schoolName,
                            role,
                          })}
                          onClick={() => onLoginAs(user, m)}
                        >
                          <LogInIcon className="size-4" aria-hidden="true" />
                          {t('loginAs')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button
                variant="outline"
                className="min-h-11 md:min-h-9"
                disabled={noLogin}
                aria-label={t('logoutFor', { name: user.fullName })}
                onClick={() => onLogout(user)}
              >
                <LogOutIcon className="size-4" aria-hidden="true" />
                {t('logout')}
              </Button>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
