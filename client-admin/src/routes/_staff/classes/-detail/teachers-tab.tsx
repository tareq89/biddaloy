import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  humanizeStatus,
} from '@biddaloy/ui/components';
import { useClassTeachers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface TeachersTabProps {
  classId: string;
}

/** Read-only — teacher CRUD is #177 ([8.11.7] Manage staff/teachers), so
 * this tab only reads `GET /classes/:classId/teachers`, no add/remove
 * actions here. */
export function TeachersTab({ classId }: TeachersTabProps) {
  const { t } = useTranslation('classes');
  const query = useClassTeachers(classId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.teachers.errorMessage')}
    >
      {(teachers) =>
        teachers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.teachers.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.teachers.columnName')}</TableHead>
                <TableHead>{t('detail.teachers.columnEmployeeId')}</TableHead>
                <TableHead>{t('detail.teachers.columnDesignations')}</TableHead>
                <TableHead>{t('detail.teachers.columnSections')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teachers.map((teacher) => (
                <TableRow key={teacher.id}>
                  <TableCell>{teacher.full_name}</TableCell>
                  <TableCell>{teacher.employee_id}</TableCell>
                  <TableCell>
                    {teacher.designations
                      .map((designation) => humanizeStatus(designation))
                      .join(', ')}
                  </TableCell>
                  <TableCell>{teacher.section_names.join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
