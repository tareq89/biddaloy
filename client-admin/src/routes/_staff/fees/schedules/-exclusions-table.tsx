/**
 * [16.7.5] Schedule detail's "Excluded students" card — add a student via
 * search (same debounced `useStudents({ search })` pattern as
 * `communications/-shared/student-search.tsx`, kept local here rather
 * than imported cross-route since that file is route-private) with one shared reason, remove
 * one already excluded. `RecurringScheduleExclusion` carries its own
 * `student_name`/`reason` so the table needs no extra student lookups.
 */
import {
  Button,
  Card,
  DataTable,
  Input,
  Label,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useAddScheduleExclusion,
  useDebouncedValue,
  useRemoveScheduleExclusion,
  useStudents,
  type RecurringScheduleExclusion,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { SearchIcon, UserMinusIcon } from 'lucide-react';
import * as React from 'react';

export interface ExclusionsTableProps {
  scheduleId: string;
  exclusions: RecurringScheduleExclusion[];
  canManage: boolean;
}

export function ExclusionsTable({ scheduleId, exclusions, canManage }: ExclusionsTableProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const [search, setSearch] = React.useState('');
  // One reason, for whichever search result is excluded.
  const [reason, setReason] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const searchQuery = useStudents(
    { search: debouncedSearch, limit: 10 },
    { enabled: debouncedSearch.trim().length > 0 },
  );
  const addExclusion = useAddScheduleExclusion(scheduleId);
  const removeExclusion = useRemoveScheduleExclusion(scheduleId);

  const excludedIds = new Set(exclusions.map((exclusion) => exclusion.student_id));
  const reasonMissing = reason.trim() === '';

  function handleAdd(studentId: string) {
    // AddExclusionDto requires `reason` (@IsNotEmpty) — the button is already disabled while this
    // is blank, but guard here too rather than trust only the disabled state.
    if (reasonMissing) return;
    addExclusion.mutate(
      { student_id: studentId, reason: reason.trim() },
      {
        onSuccess: () => {
          setSearch('');
          setReason('');
        },
      },
    );
  }

  const columns: DataTableColumn<RecurringScheduleExclusion>[] = [
    {
      id: 'student',
      header: t('schedules.columnName'),
      accessorFn: (row) => row.student_name,
      card: 'title',
    },
    {
      id: 'reason',
      header: t('schedules.detail.exclusionReasonLabel'),
      accessorFn: (row) => row.reason ?? '—',
    },
    {
      id: 'excludedOn',
      header: t('schedules.detail.columnExcludedOn'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
    },
  ];

  return (
    <Card padded>
      <h2 className="text-h2">{t('schedules.detail.exclusionsTitle')}</h2>
      <p className="mt-0.5 text-text-secondary">{t('schedules.detail.exclusionsExplanation')}</p>

      {canManage && (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exclusion-search">{t('schedules.detail.studentSearchLabel')}</Label>
              <div className="relative">
                <SearchIcon
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                  aria-hidden="true"
                />
                <Input
                  id="exclusion-search"
                  className="ps-9"
                  placeholder={t('schedules.detail.studentSearchPlaceholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exclusion-reason">
                {t('schedules.detail.exclusionReasonLabel')}
                <span className="text-destructive" aria-hidden="true">
                  {' '}
                  *
                </span>
                <span className="sr-only"> {t('form.required', { ns: 'common' })}</span>
              </Label>
              <Input
                id="exclusion-reason"
                placeholder={t('schedules.detail.exclusionReasonPlaceholder')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>

          {debouncedSearch.trim() !== '' && (
            <ul
              className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle"
              aria-live="polite"
            >
              {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
                <li className="px-3 py-3 text-text-secondary">
                  {t('schedules.detail.studentSearchNoResults')}
                </li>
              )}
              {searchQuery.data?.data
                .filter((student) => !excludedIds.has(student.id))
                .map((student) => (
                  <li
                    key={student.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{student.full_name}</span>
                      <span className="block text-caption text-text-secondary">
                        {student.registration_number}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={addExclusion.isPending || reasonMissing}
                      onClick={() => handleAdd(student.id)}
                    >
                      <UserMinusIcon aria-hidden="true" />
                      {t('schedules.detail.excludeButton')}
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}

      <div className="-mx-4 mt-4 border-t border-border-subtle md:-mx-5">
        <DataTable
          tableId="schedule-exclusions"
          caption={t('schedules.detail.exclusionsTitle')}
          columns={columns}
          data={exclusions}
          getRowId={(row) => row.student_id}
          rowActions={(row) => [
            {
              intent: 'restore',
              label: t('schedules.detail.removeExclusion'),
              allowed: canManage,
              onClick: () => removeExclusion.mutate(row.student_id),
            },
          ]}
          sorting={null}
          onSortingChange={() => {}}
          paginated={false}
          totalCount={exclusions.length}
          loading={false}
          emptyState={{
            title: t('schedules.detail.exclusionsEmptyMessage'),
            explanation: t('schedules.detail.exclusionsEmptyExplanation'),
          }}
        />
      </div>
    </Card>
  );
}
