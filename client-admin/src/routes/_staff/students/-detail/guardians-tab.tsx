import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface GuardiansTabProps {
  studentId: string;
}

/** From the student payload, per this ticket's own tab-source table —
 * `Student.guardians` is already loaded by the same `useStudent` query
 * the header and Overview tab share, not a separate endpoint. */
export function GuardiansTab({ studentId }: GuardiansTabProps) {
  const { t } = useTranslation('students');
  const query = useStudent(studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(student) =>
        student.guardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.guardians.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.guardians.columnName')}</TableHead>
                <TableHead>{t('detail.guardians.columnRelationship')}</TableHead>
                <TableHead>{t('detail.guardians.columnContact')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.guardians.map((guardian) => (
                <TableRow key={guardian.id}>
                  <TableCell>
                    {guardian.full_name}
                    {guardian.is_primary_contact && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('detail.guardians.primary')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{guardian.relationship}</TableCell>
                  <TableCell>{guardian.phone ?? guardian.email ?? t('list.emptyValue')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
