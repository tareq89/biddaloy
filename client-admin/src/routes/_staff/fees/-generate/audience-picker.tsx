/**
 * [16.3.6] The Generate Fees modal's "Students" section — search + class/
 * section/status filters over a checkbox list, plus "Select all N
 * matching" (`GET /students/ids`, `useStudentIds`) for picking a whole
 * filtered set without paging through it row by row.
 *
 * Inactive students (`enrollment_status !== 'ACTIVE'`) stay selectable —
 * `include inactive` only controls whether they show up in the list at
 * all — but each inactive row is greyed and carries a tooltip explaining
 * why, since generating a fee for a transferred/graduated student is
 * usually a mistake the accountant should notice before submitting.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useStudentIds,
  useStudentSearch,
  type Student,
  type StudentIdsFilters,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const ALL_VALUE = '__all__';

export interface AudiencePickerProps {
  academicYearId: string;
  selected: Map<string, string>;
  onSelectedChange: (selected: Map<string, string>) => void;
}

export function AudiencePicker({
  academicYearId,
  selected,
  onSelectedChange,
}: AudiencePickerProps) {
  const { t } = useTranslation('feeGeneration');
  const [search, setSearch] = React.useState('');
  const [classId, setClassId] = React.useState(ALL_VALUE);
  const [sectionId, setSectionId] = React.useState(ALL_VALUE);
  const [includeInactive, setIncludeInactive] = React.useState(false);

  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== ALL_VALUE ? classId : undefined);

  const idsFilters: StudentIdsFilters = {
    ...(search.trim() !== '' ? { search: search.trim() } : {}),
    ...(classId !== ALL_VALUE ? { class_id: classId } : {}),
    ...(sectionId !== ALL_VALUE ? { section_id: sectionId } : {}),
    ...(includeInactive ? {} : { enrollment_status: 'ACTIVE' }),
  };
  // `useStudentSearch` (the paginated list) additionally takes `limit` —
  // `GET /students/ids` does not accept it (see `StudentIdsFilters`).
  const filters = { ...idsFilters, limit: 50 };

  const studentsQuery = useStudentSearch(filters);
  const students = studentsQuery.data?.data ?? [];

  const [selectAllRequested, setSelectAllRequested] = React.useState(false);
  const idsQuery = useStudentIds(idsFilters, { enabled: selectAllRequested });

  React.useEffect(() => {
    if (!selectAllRequested) return;
    if (idsQuery.isError) {
      // Reset so a second click can retry instead of the button staying
      // stuck disabled/in-flight forever.
      setSelectAllRequested(false);
      return;
    }
    if (!idsQuery.isSuccess) return;
    const next = new Map(selected);
    const byId = new Map(students.map((student) => [student.id, student.full_name]));
    for (const id of idsQuery.data.ids) {
      // `GET /students/ids` returns ids only, not names — the currently
      // loaded page (`students`) only covers the first `limit` rows, so
      // most ids from "select all N matching" have no name here yet. A raw
      // uuid is worse than an honest placeholder: it would show up in the
      // selected chip, the duplicates list, and every later screen. The
      // placeholder self-heals below once a search page happens to load
      // that student.
      next.set(id, byId.get(id) ?? t('audience.unknownStudentName'));
    }
    onSelectedChange(next);
    setSelectAllRequested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per select-all click
  }, [selectAllRequested, idsQuery.isSuccess, idsQuery.isError, idsQuery.data]);

  const selectAllErrorMessage = React.useMemo(() => {
    if (!idsQuery.error) return null;
    if (idsQuery.error instanceof ApiError && idsQuery.error.statusCode === 413) {
      return t('audience.selectAllTooManyMatches');
    }
    return idsQuery.error instanceof Error
      ? idsQuery.error.message
      : t('audience.selectAllTooManyMatches');
  }, [idsQuery.error, t]);

  // Backfills real names into `selected` as search pages load — covers any
  // id that was set to the "unknown" placeholder by "select all" above, or
  // (defensively) any id whose name is otherwise stale.
  React.useEffect(() => {
    if (students.length === 0) return;
    let changed = false;
    const next = new Map(selected);
    for (const student of students) {
      if (next.has(student.id) && next.get(student.id) !== student.full_name) {
        next.set(student.id, student.full_name);
        changed = true;
      }
    }
    if (changed) onSelectedChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- backfill only, keyed on the loaded page
  }, [students]);

  function toggleStudent(student: Student, checked: boolean) {
    const next = new Map(selected);
    if (checked) next.set(student.id, student.full_name);
    else next.delete(student.id);
    onSelectedChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('audience.heading')}</span>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
          data-testid="selected-count-chip"
        >
          {t('audience.selectedCount', { count: selected.size })}
        </span>
      </div>

      <Input
        aria-label={t('audience.searchLabel')}
        placeholder={t('audience.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          // Enter here must never submit the surrounding form — it's a
          // search box, not the modal's confirm action.
          if (event.key === 'Enter') event.preventDefault();
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Select
          value={classId}
          onValueChange={(value) => {
            setClassId(value);
            setSectionId(ALL_VALUE);
          }}
        >
          <SelectTrigger aria-label={t('audience.classLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{t('audience.allClasses')}</SelectItem>
            {classesQuery.data?.data.map((klass) => (
              <SelectItem key={klass.id} value={klass.id}>
                {klass.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {classId !== ALL_VALUE && (
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger aria-label={t('audience.sectionLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('audience.allSections')}</SelectItem>
              {sectionsQuery.data?.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.section_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            aria-label={t('audience.includeInactiveLabel')}
          />
          {t('audience.includeInactiveLabel')}
        </label>
      </div>

      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className="self-start text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => setSelectAllRequested(true)}
          disabled={idsQuery.isFetching}
        >
          {t('audience.selectAllMatching', {
            count: idsQuery.data?.total ?? studentsQuery.data?.total ?? 0,
          })}
        </button>
        {selectAllErrorMessage && (
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <span>{selectAllErrorMessage}</span>
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              onClick={() => setSelectAllRequested(true)}
            >
              {t('audience.selectAllRetry')}
            </button>
          </div>
        )}
      </div>

      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-2">
        {studentsQuery.isPending && (
          <li className="text-sm text-muted-foreground">{t('audience.loading')}</li>
        )}
        {studentsQuery.isSuccess && students.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('audience.empty')}</li>
        )}
        {students.map((student) => {
          const isActive = student.enrollment_status === 'ACTIVE';
          const row = (
            <li
              key={student.id}
              className={`flex items-center gap-2 rounded px-1 py-1 ${isActive ? '' : 'opacity-50'}`}
            >
              <Checkbox
                checked={selected.has(student.id)}
                onCheckedChange={(checked) => toggleStudent(student, checked === true)}
                aria-label={student.full_name}
              />
              <span className="text-sm">{student.full_name}</span>
            </li>
          );
          if (isActive) return row;
          return (
            <Tooltip key={student.id}>
              <TooltipTrigger asChild>{row}</TooltipTrigger>
              <TooltipContent>{t('audience.inactiveTooltip')}</TooltipContent>
            </Tooltip>
          );
        })}
      </ul>
    </div>
  );
}
