/**
 * Search-and-pick a single student, the same debounced-`Input` +
 * result-list building blocks `students/-guardian-picker.tsx` composes
 * (that component's own header comment explains why it isn't built on
 * `Combobox`: server-side search, not a static option list — the same
 * reasoning applies here) — single-select instead of multi, no inline
 * create.
 *
 * Only rendered when `record.tsx`'s `student_id` search param is absent.
 * When it's present (deep-linked from a student's "Collect fees" row
 * action), the wizard skips straight to the outstanding-fees step with
 * that student already resolved — see `-record-payment-wizard.tsx`.
 */
import { Input } from '@biddaloy/ui/components';
import { useDebouncedValue, useStudents, type Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface FindStudentStepProps {
  onSelect: (student: Student) => void;
}

export function FindStudentStep({ onSelect }: FindStudentStepProps) {
  const { t } = useTranslation('payments');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const query = useStudents({ search: debouncedSearch });

  return (
    <div className="flex flex-col gap-3">
      <Input
        id="record-payment-find-student"
        aria-label={t('record.findStudent.searchLabel')}
        placeholder={t('record.findStudent.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {debouncedSearch.trim() !== '' && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-live="polite">
          {query.isSuccess && query.data.data.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('record.findStudent.noResults')}</li>
          )}
          {query.data?.data.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => onSelect(student)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-start text-sm hover:bg-accent"
              >
                <span>{student.full_name}</span>
                <span className="text-muted-foreground">
                  {t('record.findStudent.rollAndClass', {
                    roll: student.roll_number,
                    className: student.class_section.class.name,
                    sectionName: student.class_section.section_name,
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
