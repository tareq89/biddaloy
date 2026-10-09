import { Permission } from '@biddaloy/shared';
import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useHasPermission, useStudent, type Guardian } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { UsersRoundIcon } from 'lucide-react';

import { TabQueryState } from './tab-query-state';

export interface GuardiansTabProps {
  studentId: string;
}

const KNOWN_RELATIONSHIPS = [
  'father',
  'mother',
  'brother',
  'sister',
  'grandfather',
  'grandmother',
  'uncle',
  'aunt',
  'other',
];

/** From the student payload, per this ticket's own tab-source table —
 * `Student.guardians` is already loaded by the same `useStudent` query
 * the header and Overview tab share, not a separate endpoint. */
export function GuardiansTab({ studentId }: GuardiansTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const query = useStudent(studentId);
  const canEdit = useHasPermission(Permission.STUDENT_UPDATE);

  // Free text field: known English values are translated, anything else is shown as typed.
  const relationshipLabel = (relationship: string): string => {
    const key = relationship.trim().toLowerCase();
    return KNOWN_RELATIONSHIPS.includes(key)
      ? t(`enums.relationship.${key}`, { ns: 'common' })
      : relationship;
  };

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
