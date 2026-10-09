import { Permission } from '@biddaloy/shared';
import { Button, StatusBadge } from '@biddaloy/ui/components';
import { useHasPermission, useTeachers, useUser } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { PencilIcon } from 'lucide-react';

import { formatStaffPhone } from '../-format-staff-phone';

import { InvitationCard } from './invitation-card';
import { TabQueryState } from './tab-query-state';

export interface ProfileTabProps {
  userId: string;
  /** Opens the edit-teacher dialog (mounted by the route); the button is
   * hidden without `USER_UPDATE` or when omitted. */
  onEditTeacher?: () => void;
}

const CARD = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
const DT = 'text-caption text-text-secondary';

/**
 * The user's contact details plus, when one exists, their teacher profile
 * (found via `GET /teachers?user_id=` — the server-side exact filter
 * added for [8.11.8], so a 500-member school doesn't page the whole
 * teacher list client-side to answer "is this person a teacher?").
 * Role, status, joined and last sign-in live in the page header facts.
 */
export function ProfileTab({ userId, onEditTeacher }: ProfileTabProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const canUpdate = useHasPermission(Permission.USER_UPDATE);
  const query = useUser(userId);
  const teacherQuery = useTeachers({ user_id: userId, limit: 1 });
  const teacher = teacherQuery.data?.data[0];

  const verification = (verifiedAt: string | null) => (
    <span
      {...(verifiedAt
        ? {
            title: t('detail.contact.verified', {
              date: formatDate(new Date(verifiedAt), regionConfig),
            }),
          }
        : {})}
    >
      <StatusBadge
        tone={verifiedAt ? 'success' : 'neutral'}
        label={verifiedAt ? t('detail.contact.verifiedBadge') : t('detail.contact.unverified')}
      />
    </span>
  );

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(user) => (
        <div className="space-y-6">
          <InvitationCard user={user} />

          <section className={CARD}>
            <h2 className="text-h2">{t('detail.profile.contactHeading')}</h2>
            <dl className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <dt className={DT}>{t('detail.profile.columnEmail')}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="break-all">{user.email || t('detail.profile.emptyValue')}</span>
                  {user.email && verification(user.email_verified_at)}
                </dd>
              </div>
              <div>
                <dt className={DT}>{t('detail.profile.columnPhone')}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span>
                    {formatStaffPhone(user.phone, regionConfig) ?? t('detail.profile.emptyValue')}
                  </span>
                  {user.phone && verification(user.phone_verified_at)}
                </dd>
              </div>
              <div>
                <dt className={DT}>{t('detail.profile.accountCreated')}</dt>
                <dd>{formatDate(new Date(user.created_at), regionConfig)}</dd>
              </div>
            </dl>
          </section>

          {teacher !== undefined && (
            <section className={CARD} aria-label={t('detail.profile.teacherHeading')}>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-h2">{t('detail.profile.teacherHeading')}</h2>
                {canUpdate && onEditTeacher && (
                  <Button type="button" variant="outline" onClick={onEditTeacher}>
                    <PencilIcon aria-hidden="true" />
                    {t('detail.profile.editTeacher')}
                  </Button>
                )}
              </div>
              <dl className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <dt className={DT}>{t('detail.profile.designations')}</dt>
                  <dd>
                    {teacher.designations.length > 0
                      ? teacher.designations
                          .map((designation) => t(`teacherForm.designations.${designation}`))
                          .join(', ')
                      : t('detail.profile.emptyValue')}
                  </dd>
                </div>
                <div>
                  <dt className={DT}>{t('detail.profile.subject')}</dt>
                  <dd>{teacher.subject_specialization || t('detail.profile.emptyValue')}</dd>
                </div>
                <div>
                  <dt className={DT}>{t('detail.profile.joiningDate')}</dt>
                  <dd>
                    {teacher.joining_date !== null
                      ? formatDate(parseServerDate(teacher.joining_date), regionConfig)
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
