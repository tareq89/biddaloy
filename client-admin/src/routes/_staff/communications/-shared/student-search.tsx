/**
 * Single-select student search shared by the Send Message and Fee
 * Reminders pages — the single-select sibling of `guardians/
 * -student-picker.tsx`'s multi-select shape (same debounced
 * `useStudents({ search })` query, same live-region result list), except
 * choosing a result is terminal: it hands the whole `Student` to the
 * caller and clears the search, because both callers replace this widget
 * with a "selected student" summary of their own.
 */
import { Button, Input } from '@biddaloy/ui/components';
import { useDebouncedValue, useStudents, type Student } from '@biddaloy/ui/hooks';
import * as React from 'react';

export interface StudentSearchProps {
  inputId: string;
  searchLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  onSelect: (student: Student) => void;
}

export function StudentSearch({
  inputId,
  searchLabel,
  searchPlaceholder,
  noResultsLabel,
  onSelect,
}: StudentSearchProps) {
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const searchQuery = useStudents(
    { search: debouncedSearch, limit: 10 },
    { enabled: debouncedSearch.trim().length > 0 },
  );

  function handleSelect(student: Student) {
    setSearch('');
    onSelect(student);
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={inputId}
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {debouncedSearch.trim() !== '' && (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-live="polite">
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
            <li className="text-sm text-muted-foreground">{noResultsLabel}</li>
          )}
          {searchQuery.data?.data.map((student) => (
            <li key={student.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => handleSelect(student)}
              >
                {student.full_name} · {student.registration_number}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
