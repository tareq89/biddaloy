import { Permission } from '@biddaloy/shared';
import { isNotFoundError } from '@biddaloy/ui/api';
import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useActiveTenant,
  useArrivalSubscriptions,
  useHasPermission,
  useSchoolSettings,
  useStudent,
  type Guardian,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { UsersRoundIcon } from 'lucide-react';

import { ArrivalNoticeCell } from './-arrival-notice-cell';
import { useRelationshipLabel } from './relationship-label';
import { TabQueryState } from './tab-query-state';

export interface GuardiansTabProps {
  studentId: string;
}

/** From the student payload, per this ticket's own tab-source table —
 * `Student.guardians` is already loaded by the same `useStudent` query
 * the header and Overview tab share, not a separate endpoint. */
export function GuardiansTab({ studentId }: GuardiansTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const query = useStudent(studentId);
  const canEdit = useHasPermission(Permission.STUDENT_UPDATE);
  const canManageArrival = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE);
  const canLockArrival = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK);
  // School settings are ADMIN-only on the server, so only a lock holder can learn the switch is
  // off. A TEACHER or EXECUTIVE still sees the column while it is off: the server keeps listing
  // and accepting rows then, and no notice is sent until the switch is on (11-attendance
  // "Known limits").
  const tenantId = useActiveTenant();
  const settings = useSchoolSettings(canLockArrival ? (tenantId ?? '') : '');
  const arrivalOff = settings.data?.attendance?.arrivalNotice?.enabled === false;
  // One read for the whole tab (the cells share it by query key). The list needs MANAGE, and a
  // teacher who is not this section's class teacher gets a 404: no column for them at all.
  const sectionId = query.data?.class_section_id ?? '';
  const arrivalList = useArrivalSubscriptions(
    { sectionId },
    { enabled: canManageArrival && !arrivalOff && sectionId !== '' },
  );
  const showArrival = canManageArrival && !arrivalOff && !isNotFoundError(arrivalList.error);
  const relationshipLabel = useRelationshipLabel();

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(student) => {
        const guardians = [...student.guardians].sort(
          (a, b) => Number(b.is_primary_contact) - Number(a.is_primary_contact),
        );
        const columns: DataTableColumn<Guardian>[] = [
          {
            id: 'name',
            header: t('detail.guardians.columnName'),
            accessorFn: (guardian) => (
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {guardian.full_name}
                {guardian.is_primary_contact && (
                  <span className="text-caption font-normal text-text-secondary">
                    {t('detail.guardians.primary')}
                  </span>
                )}
              </span>
            ),
            card: 'title',
          },
          {
            id: 'relationship',
            header: t('detail.guardians.columnRelationship'),
            accessorFn: (guardian) => relationshipLabel(guardian.relationship),
            card: 'subtitle',
          },
          {
            id: 'phone',
            header: t('detail.guardians.columnPhone'),
            accessorFn: (guardian) =>
              guardian.phone ? formatPhone(guardian.phone, config) : t('list.emptyValue'),
          },
          {
            id: 'email',
            header: t('detail.guardians.columnEmail'),
            accessorFn: (guardian) => guardian.email ?? t('list.emptyValue'),
          },
          {
            id: 'preferred',
            header: t('detail.guardians.columnPreferred'),
            accessorFn: (guardian) =>
              guardian.preferred_communication
                ? t(`form.preferredCommunicationOptions.${guardian.preferred_communication}`)
                : t('list.emptyValue'),
          },
          ...(showArrival
            ? [
                {
                  id: 'arrival',
                  header: t('detail.guardians.columnArrival'),
                  accessorFn: (guardian: Guardian) => (
                    <ArrivalNoticeCell
                      studentId={studentId}
                      sectionId={student.class_section_id}
                      guardian={guardian}
                    />
                  ),
                },
              ]
            : []),
        ];
        return (
          <div className="flex flex-col gap-3">
            <DataTable
              tableId="student-guardians"
              caption={t('detail.guardians.caption', { name: student.full_name })}
              paginated={false}
              sorting={null}
              onSortingChange={() => {}}
              columns={columns}
              data={guardians}
              getRowId={(guardian) => guardian.id}
              totalCount={guardians.length}
              rowActions={(guardian) => [
                {
                  intent: 'view',
                  label: t('detail.guardians.view', { name: guardian.full_name }),
                  to: `/guardians/${guardian.id}`,
                },
              ]}
              emptyState={{
                title: t('detail.guardians.emptyMessage'),
                explanation: t('detail.guardians.emptyExplanation'),
                icon: <UsersRoundIcon aria-hidden="true" />,
              }}
            />
            {canEdit && (
              <p className="text-text-secondary">
                {t('detail.guardians.editHintBefore')}{' '}
                <Link
                  to="/students/$studentId/edit"
                  params={{ studentId }}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {t('detail.guardians.editHintLink')}
                </Link>
                {t('detail.guardians.editHintAfter')}
              </p>
            )}
          </div>
        );
      }}
    </TabQueryState>
  );
}
