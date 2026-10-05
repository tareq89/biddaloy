/** [17.4.2] / [31.4] Type + class filter bar above the month grid. */
import { CalendarEventType } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, type FilterFieldDescriptor } from '@biddaloy/ui/shells';

export interface CalendarFiltersProps {
  types: CalendarEventType[];
  onTypesChange: (types: CalendarEventType[]) => void;
  classId: string | undefined;
  onClassIdChange: (classId: string | undefined) => void;
  classOptions: { id: string; name: string }[];
}

export function CalendarFilters({
  types,
  onTypesChange,
  classId,
  onClassIdChange,
  classOptions,
}: CalendarFiltersProps) {
  const { t } = useTranslation('calendar');

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'types',
      label: t('filters.typesLabel'),
      allLabel: t('filters.allTypes'),
      options: Object.values(CalendarEventType).map((value) => ({
        value,
        label: t(`types.${value}`),
      })),
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('filters.classLabel'),
      allLabel: t('filters.allClasses'),
      options: classOptions.map((option) => ({ value: option.id, label: option.name })),
    },
  ];

  // Single-select control mapped onto the multi-value `types` filter: one
  // type at a time is enough; the query layer
  // (`CalendarEventsFilters.types`) already accepts an array so a future
  // multi-select swap doesn't touch the data layer.
  const values: Record<string, string> = {};
  if (types[0]) values.types = types[0];
  if (classId) values.class_id = classId;

  return (
    <FilterBar
      fields={fields}
      values={values}
      onChange={(patch) => {
        if ('types' in patch) {
          onTypesChange(patch.types ? [patch.types as CalendarEventType] : []);
        }
        if ('class_id' in patch) onClassIdChange(patch.class_id ?? undefined);
      }}
    />
  );
}
