/**
 * [8.11.5]'s selected-students picker — adapted from
 * `guardians/-student-picker.tsx`, with one deliberate difference: a fee
 * structure can only ever apply to students *in its own class*, so this
 * picker lists that class's roster up front (`class_id`-filtered) instead
 * of starting empty and requiring a search. The search box narrows the
 * roster rather than being the only way to see anything.
 *
 * Keeps its own `id -> Student` cache so a student selected before the
 * search was narrowed still renders their name afterwards — `selectedIds`
 * alone carries no name to show.
 */
import { Checkbox, Input } from '@biddaloy/ui/components';
import { useDebouncedValue, useStudents, type Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** A single class's roster fits one generous page — the same ceiling
 * `classes.ts`'s `CLASS_FILTER_LIMIT` sets for a filter dropdown's list,
 * and for the same reason: nobody paginates a picker. */
const ROSTER_LIMIT = 100;

export interface FeeStructureStudentPickerProps {
  classId: string | undefined;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Already-linked students (edit mode) — seeds the name cache so they
   * render immediately, before the roster query resolves. */
  initialStudents?: Student[];
}

export function FeeStructureStudentPicker({
  classId,
  selectedIds,
  onSelectedIdsChange,
  initialStudents = [],
}: FeeStructureStudentPickerProps) {
  const { t } = useTranslation('feeStructures');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [knownStudents, setKnownStudents] = React.useState<Record<string, Student>>(() =>
    Object.fromEntries(initialStudents.map((student) => [student.id, student])),
  );

  // `initialStudents` arrives *after* first render in edit mode: the picker
  // mounts as soon as applicability is SELECTED, while the detail query that
  // supplies the prefilled students is still loading. A lazy `useState`
  // initializer alone would therefore only ever capture the empty array, and
  // a prefilled student outside the first `ROSTER_LIMIT` rows (or filtered
  // out by a search) would render as a raw UUID.
  // Keyed on the ids rather than the array's identity: callers build this
  // prop inline, so a fresh array arrives on every render and depending on
  // its reference would re-run this forever.
  const initialStudentIds = initialStudents.map((student) => student.id).join(',');
  React.useEffect(() => {
    if (initialStudents.length === 0) return;
    setKnownStudents((current) => {
      const next = { ...current };
      for (const student of initialStudents) next[student.id] = student;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStudentIds]);

  const rosterQuery = useStudents({
    limit: ROSTER_LIMIT,
    ...(classId !== undefined ? { class_id: classId } : {}),
    ...(debouncedSearch.trim() !== '' ? { search: debouncedSearch } : {}),
  });

  React.useEffect(() => {
    const results = rosterQuery.data?.data;
    if (!results || results.length === 0) return;
    setKnownStudents((current) => {
      const next = { ...current };
      for (const student of results) next[student.id] = student;
      return next;
    });
  }, [rosterQuery.data]);

  function toggleSelected(id: string) {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  }

  const roster = rosterQuery.data?.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fee-structure-student-search" className="text-sm font-medium">
          {t('studentPicker.label')}
        </label>
        <Input
          id="fee-structure-student-search"
          aria-label={t('studentPicker.searchLabel')}
          placeholder={t('studentPicker.searchLabel')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('studentPicker.selectedCount', { count: selectedIds.length })}
      </p>

      {rosterQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('studentPicker.errorMessage')}
        </p>
      )}

      {rosterQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('studentPicker.loading')}</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {rosterQuery.isSuccess && roster.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('studentPicker.emptyMessage')}</li>
          )}
          {roster.map((student) => (
            <li key={student.id} className="flex items-center gap-2">
              <Checkbox
                id={`fee-structure-student-${student.id}`}
                checked={selectedIds.includes(student.id)}
                onCheckedChange={() => toggleSelected(student.id)}
              />
              <label htmlFor={`fee-structure-student-${student.id}`} className="text-sm">
                {student.full_name} · {student.registration_number}
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* Selected students who aren't in the current (possibly narrowed)
          roster still need to be visible — otherwise narrowing the search
          would make a selection look like it had been lost. */}
      {selectedIds
        .filter((id) => !roster.some((student) => student.id === id))
        .map((id) => (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={`fee-structure-selected-${id}`}
              checked
              onCheckedChange={() => toggleSelected(id)}
            />
            <label htmlFor={`fee-structure-selected-${id}`} className="text-sm">
              {knownStudents[id]?.full_name ?? id}
            </label>
          </div>
        ))}
    </div>
  );
}
