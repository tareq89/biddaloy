import { StatusBadge } from '@biddaloy/ui/components';
import { useTeachers, useUser } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

import { formatStaffPhone } from '../-format-staff-phone';

import { TabQueryState } from './tab-query-state';

export interface ProfileTabProps {
  userId: string;
}

/**
 * The user's account fields plus, when one exists, their teacher profile
 * (found via `GET /teachers?user_id=` — the server-side exact filter
 * added for [8.11.8], so a 500-member school doesn't page the whole
 * teacher list client-side to answer "is this person a teacher?").
 */
export function ProfileTab({ userId }: ProfileTabProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const query = useUser(userId);
  const teacherQuery = useTeachers({ user_id: userId, limit: 1 });
  const teacher = teacherQuery.data?.data[0];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(user) => (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">{t('detail.profile.columnEmail')}</dt>
              <dd>{user.email || t('detail.profile.emptyValue')}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('detail.profile.columnPhone')}</dt>
              <dd>
                {formatStaffPhone(user.phone, regionConfig) ?? t('detail.profile.emptyValue')}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('detail.profile.columnRole')}</dt>
              <dd>
                {user.role !== null ? t(`roles.${user.role}`) : t('detail.profile.emptyValue')}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('detail.profile.columnStatus')}</dt>
              <dd>
                <StatusBadge domain="user" status={user.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t('detail.profile.columnJoined')}</dt>
              <dd>{formatDate(new Date(user.created_at), regionConfig)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t('detail.profile.columnLastLogin')}
              </dt>
              <dd>
                {user.last_login_at !== null
                  ? formatDate(new Date(user.last_login_at), regionConfig)
                  : t('detail.profile.emptyValue')}
              </dd>
            </div>
          </dl>

          {teacher !== undefined && (
            <section aria-label={t('detail.profile.teacherHeading')}>
              <h2 className="mb-2 text-sm font-semibold">{t('detail.profile.teacherHeading')}</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('detail.profile.employeeId')}
                  </dt>
                  <dd>{teacher.employee_id}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('detail.profile.designations')}
                  </dt>
                  <dd>
                    {teacher.designations.length > 0
                      ? teacher.designations
                          .map((designation) => t(`teacherForm.designations.${designation}`))
                          .join(', ')
                      : t('detail.profile.emptyValue')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t('detail.profile.subject')}</dt>
                  <dd>{teacher.subject_specialization || t('detail.profile.emptyValue')}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('detail.profile.joiningDate')}
                  </dt>
                  <dd>
                    {teacher.joining_date !== null
                      ? formatDate(new Date(teacher.joining_date), regionConfig)
                      : t('detail.profile.emptyValue')}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}
    </TabQueryState>
  );
}
