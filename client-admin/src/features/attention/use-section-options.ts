import type { ComboboxOption } from '@biddaloy/ui/components';
import { classSectionsQueryOptions, useAllClasses } from '@biddaloy/ui/hooks';
import { useQueries } from '@tanstack/react-query';

/** "Class – Section" options for every section of every class. */
export function useSectionOptions(): ComboboxOption[] {
  const classes = useAllClasses();
  const sections = useQueries({
    queries: (classes.data ?? []).map((klass) => classSectionsQueryOptions(klass.id)),
  });
  return (classes.data ?? []).flatMap((klass, i) =>
    (sections[i]?.data ?? []).map((s) => ({
      value: s.id,
      label: `${klass.name} – ${s.section_name}`,
    })),
  );
}
