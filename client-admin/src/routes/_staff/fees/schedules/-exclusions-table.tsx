/**
 * [16.7.5] Schedule detail's exclusions section — add a student via
 * search (same debounced `useStudents({ search })` pattern as
 * `communications/-shared/student-search.tsx`, kept local here rather
 * than imported cross-route since that file is route-private), remove
 * one already excluded. `RecurringScheduleExclusion` carries its own
 * `student_name`/`reason` so the table needs no extra student lookups.
 */
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import {
  useAddScheduleExclusion,
  useDebouncedValue,
  useRemoveScheduleExclusion,
  useStudents,
  type RecurringScheduleExclusion,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ExclusionsTableProps {
  scheduleId: string;
  exclusions: RecurringScheduleExclusion[];
  canManage: boolean;
}

export function ExclusionsTable({ scheduleId, exclusions, canManage }: ExclusionsTableProps) {
  const { t } = useTranslation('fees');
  const [search, setSearch] = React.useState('');
  const [reasonByStudent, setReasonByStudent] = React.useState<Record<string, string>>({});
  const debouncedSearch = useDebouncedValue(search, 300);
  const searchQuery = useStudents(
    { search: debouncedSearch, limit: 10 },
    { enabled: debouncedSearch.trim().length > 0 },
  );
  const addExclusion = useAddScheduleExclusion(scheduleId);
  const removeExclusion = useRemoveScheduleExclusion(scheduleId);

  const excludedIds = new Set(exclusions.map((exclusion) => exclusion.student_id));

  function handleAdd(studentId: string) {
    const reason = reasonByStudent[studentId]?.trim();
    addExclusion.mutate(
      { student_id: studentId, ...(reason ? { reason } : {}) },
      { onSuccess: () => setSearch('') },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('schedules.detail.addExclusion')}</span>
        <Input
          aria-label={t('schedules.detail.studentSearchLabel')}
          placeholder={t('schedules.detail.studentSearchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {debouncedSearch.trim() !== '' && (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-live="polite">
            {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
              <li className="text-sm text-muted-foreground">
                {t('schedules.detail.studentSearchNoResults')}
              </li>
            )}
            {searchQuery.data?.data
              .filter((student) => !excludedIds.has(student.id))
              .map((student) => (
                <li key={student.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{student.full_name}</span>
                  <Input
                    aria-label={t('schedules.detail.exclusionReasonLabel')}
                    placeholder={t('schedules.detail.exclusionReasonPlaceholder')}
                    value={reasonByStudent[student.id] ?? ''}
                    onChange={(event) =>
                      setReasonByStudent((prev) => ({ ...prev, [student.id]: event.target.value }))
                    }
                    className="max-w-48"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={addExclusion.isPending}
                    onClick={() => handleAdd(student.id)}
                  >
                    {t('schedules.detail.addExclusion')}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {exclusions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('schedules.detail.exclusionsEmptyMessage')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('schedules.columnName')}</TableHead>
              <TableHead>{t('schedules.detail.exclusionReasonLabel')}</TableHead>
              {canManage && <TableHead>{t('schedules.columnActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {exclusions.map((exclusion) => (
              <TableRow key={exclusion.student_id}>
                <TableCell>{exclusion.student_name}</TableCell>
                <TableCell>{exclusion.reason ?? '—'}</TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={removeExclusion.isPending}
                      onClick={() => removeExclusion.mutate(exclusion.student_id)}
                    >
                      {t('schedules.detail.removeExclusion')}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
