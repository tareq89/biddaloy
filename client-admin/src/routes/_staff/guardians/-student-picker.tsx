/**
 * [8.11.4]'s Linked Students tab editor — the reverse direction of
 * `students/-guardian-picker.tsx` (that one links guardians onto a
 * student; this one links students onto a guardian). Same search-and-link
 * shape, no inline "create a new student" escape hatch — unlike a
 * guardian, a student is never created just to satisfy a link on this
 * page, so that half of `GuardianPicker` has no counterpart here.
 *
 * Keeps its own `id -> Student` cache (`knownStudents`) so a selected
 * student's name still renders once the search query that found them has
 * changed or been cleared — `selectedIds` alone has no name to show.
 */
import { Button, Checkbox, Input } from '@biddaloy/ui/components';
import { useDebouncedValue, useStudents, type Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface StudentPickerProps {
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Already-linked students (edit mode) — seeds `knownStudents` so they
   * render immediately, before any search has run. */
  initialStudents?: Student[];
}

export function StudentPicker({
  selectedIds,
  onSelectedIdsChange,
  initialStudents = [],
}: StudentPickerProps) {
  const { t } = useTranslation('guardians');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [knownStudents, setKnownStudents] = React.useState<Record<string, Student>>(() =>
    Object.fromEntries(initialStudents.map((student) => [student.id, student])),
  );

  const searchQuery = useStudents({ search: debouncedSearch, limit: 10 });

  React.useEffect(() => {
    const results = searchQuery.data?.data;
    if (!results || results.length === 0) return;
    setKnownStudents((current) => {
      const next = { ...current };
      for (const student of results) next[student.id] = student;
      return next;
    });
  }, [searchQuery.data]);

  function toggleSelected(id: string) {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  }

  function removeSelected(id: string) {
    onSelectedIdsChange(selectedIds.filter((existing) => existing !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {selectedIds.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={t('studentPicker.selectedLabel')}>
          {selectedIds.map((id) => {
            const student = knownStudents[id];
            return (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-1.5 text-sm"
              >
                <span>{student?.full_name ?? id}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSelected(id)}
                  aria-label={t('studentPicker.removeAction', {
                    name: student?.full_name ?? id,
                  })}
                >
                  {t('studentPicker.removeAction_short')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Input
        id="guardian-form-student-search"
        aria-label={t('studentPicker.searchLabel')}
        placeholder={t('studentPicker.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {debouncedSearch.trim() !== '' && (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-live="polite">
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('studentPicker.noResults')}</li>
          )}
          {searchQuery.data?.data.map((student) => (
            <li key={student.id} className="flex items-center gap-2">
              <Checkbox
                id={`student-result-${student.id}`}
                checked={selectedIds.includes(student.id)}
                onCheckedChange={() => toggleSelected(student.id)}
              />
              <label htmlFor={`student-result-${student.id}`} className="text-sm">
                {student.full_name} · {student.registration_number}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
