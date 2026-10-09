/**
 * [16.3.6] The Generate Fees full-page form's "Students" card — search +
 * class/section/program filters over a checkbox list, plus "Select all N
 * matching" (`GET /students/ids`, `useStudentIds`) for picking a whole
 * filtered set without paging through it row by row.
 *
 * Inactive students (`enrollment_status !== 'ACTIVE'`) stay selectable —
 * `include inactive` only controls whether they show up in the list at
 * all — but each inactive row carries an "Inactive" badge, since generating
 * a fee for a transferred/graduated student is usually a mistake the
 * accountant should notice before submitting.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  programsQueryOptions,
  useClasses,
  useClassSections,
  useHasPermission,
  useStudentIds,
  useStudentSearch,
  type Student,
  type StudentIdsFilters,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { ListChecksIcon, SearchIcon } from 'lucide-react';
import * as React from 'react';

const ALL_VALUE = '__all__';

export interface AudiencePickerProps {
  academicYearId: string;
  selected: Map<string, string>;
  onSelectedChange: (selected: Map<string, string>) => void;
  /** [34.5.3] `program_id` isn't a `GET /students*` filter (see
   * `StudentIdsFilters`) — a program select here can't narrow this picker's
   * own checkbox list. It only surfaces the chosen program so the caller
   * (`generate-fees-modal.tsx`) can add `program_id` to `GenerateFeesDto`,
   * which the server does accept alongside `student_ids`. */
  programId?: string | undefined;
  onProgramIdChange?: (programId: string | undefined) => void;
}

export function AudiencePicker({
  academicYearId,
  selected,
  onSelectedChange,
  programId,
  onProgramIdChange,
}: AudiencePickerProps) {
  const { t } = useTranslation('feeGeneration');
  const regionConfig = useRegionConfig();
  const [search, setSearch] = React.useState('');
  const [classId, setClassId] = React.useState(ALL_VALUE);
  const [sectionId, setSectionId] = React.useState(ALL_VALUE);
  const [includeInactive, setIncludeInactive] = React.useState(false);

  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== ALL_VALUE ? classId : undefined);
  // A role without `PROGRAM_READ` cannot call `GET /programs` — no request, no program field.
  const canReadPrograms = useHasPermission(Permission.PROGRAM_READ);
  const programsQuery = useQuery({
    ...programsQueryOptions({ includeArchived: false }),
    enabled: canReadPrograms,
  });

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
      // selected pill, the duplicates list, and every later screen. The
      // placeholder self-heals below once a search page happens to load
      // that student.
      next.set(id, byId.get(id) ?? t('audience.unknownStudentName'));
    }
    onSelectedChange(next);
    setSelectAllRequested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per select-all click
  }, [selectAllRequested, idsQuery.isSuccess, idsQuery.isError, idsQuery.data]);

  // Never the server's own message — only translated sentences reach the screen.
  const selectAllErrorMessage = React.useMemo(() => {
    if (!idsQuery.error) return null;
    if (idsQuery.error instanceof ApiError && idsQuery.error.statusCode === 413) {
      return t('audience.selectAllTooManyMatches');
    }
    return t('audience.selectAllFailed');
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

  const matchCount = idsQuery.data?.total ?? studentsQuery.data?.total ?? 0;

  return (
    <Card padded>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2">{t('audience.heading')}</h2>
          <p className="mt-0.5 text-text-secondary">{t('section.studentsDescription')}</p>
        </div>
        <span
          className="inline-flex h-6 shrink-0 items-center rounded-full bg-secondary px-2 text-label text-secondary-foreground"
          data-testid="selected-count-chip"
        >
          {t('audience.selectedCount', {
            count: selected.size,
            n: formatNumber(selected.size, regionConfig),
          })}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1.5 md:col-span-3">
          <Label htmlFor="audience-search">{t('audience.searchLabel')}</Label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <Input
              id="audience-search"
              className="ps-9"
              placeholder={t('audience.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                // Enter here must never submit the surrounding form — it's a
                // search box, not the form's confirm action.
                if (event.key === 'Enter') event.preventDefault();
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audience-class">{t('audience.classLabel')}</Label>
          <Select
            value={classId}
            onValueChange={(value) => {
              setClassId(value);
              setSectionId(ALL_VALUE);
            }}
          >
            <SelectTrigger id="audience-class">
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audience-section">{t('audience.sectionLabel')}</Label>
          <Select value={sectionId} onValueChange={setSectionId} disabled={classId === ALL_VALUE}>
            <SelectTrigger id="audience-section" disabled={classId === ALL_VALUE}>
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
        </div>

        {onProgramIdChange && canReadPrograms && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audience-program">{t('audience.programLabel')}</Label>
            <Select
              value={programId ?? ALL_VALUE}
              onValueChange={(value) => onProgramIdChange(value === ALL_VALUE ? undefined : value)}
            >
              <SelectTrigger id="audience-program">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('audience.anyProgram')}</SelectItem>
                {programsQuery.data?.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <label className="flex min-h-11 items-center gap-3 md:col-span-3 md:min-h-8">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(checked === true)}
          />
          {t('audience.includeInactiveLabel')}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <p className="text-text-secondary">
          {t('audience.matchCount', {
            count: studentsQuery.data?.total ?? 0,
            n: formatNumber(studentsQuery.data?.total ?? 0, regionConfig),
          })}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="text-primary"
          onClick={() => setSelectAllRequested(true)}
          disabled={idsQuery.isFetching}
        >
          <ListChecksIcon aria-hidden="true" />
          {t('audience.selectAllMatching', { n: formatNumber(matchCount, regionConfig) })}
        </Button>
      </div>
      {selectAllErrorMessage && (
        <p role="alert" className="mt-2 flex items-center gap-2 text-caption text-destructive">
          {selectAllErrorMessage}
          <Button type="button" variant="ghost" onClick={() => setSelectAllRequested(true)}>
            {t('audience.selectAllRetry')}
          </Button>
        </p>
      )}

      <ul
        aria-label={t('audience.heading')}
        className="mt-2 max-h-80 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle"
      >
        {studentsQuery.isPending && (
          <li className="px-3 py-3 text-text-secondary">{t('audience.loading')}</li>
        )}
        {studentsQuery.isSuccess && students.length === 0 && (
          <li className="px-3 py-3 text-text-secondary">{t('audience.empty')}</li>
        )}
        {students.map((student) => (
          <li key={student.id} className="px-3">
            <label className="flex min-h-11 items-center gap-3 md:min-h-9">
              <Checkbox
                checked={selected.has(student.id)}
                onCheckedChange={(checked) => toggleStudent(student, checked === true)}
              />
              <span className="min-w-0 flex-1">
                <span className="block">{student.full_name}</span>
                <span className="block text-caption text-text-secondary">
                  {student.registration_number}
                </span>
              </span>
              {student.enrollment_status !== 'ACTIVE' && (
                <StatusBadge tone="neutral" label={t('audience.inactiveBadge')} />
              )}
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
