/** [17.4.2] Type + class filter bar above the grid/agenda. */
import { CalendarEventType } from '@biddaloy/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface CalendarFiltersProps {
  types: CalendarEventType[];
  onTypesChange: (types: CalendarEventType[]) => void;
  classId: string | undefined;
  onClassIdChange: (classId: string | undefined) => void;
  classOptions: { id: string; name: string }[];
}

const ALL_TYPES_VALUE = '__all__';
const ALL_CLASSES_VALUE = '__all__';

export function CalendarFilters({
  types,
  onTypesChange,
  classId,
  onClassIdChange,
  classOptions,
}: CalendarFiltersProps) {
  const { t } = useTranslation('calendar');

  // Single-select control mapped onto the multi-value `types` filter: one
  // type at a time is enough for this ticket's scope; the query layer
  // (`CalendarEventsFilters.types`) already accepts an array so a future
  // multi-select swap doesn't touch the data layer.
  const selectedType = types[0];

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="calendar-filter-type" className="text-xs font-medium text-muted-foreground">
          {t('filters.typesLabel')}
        </label>
        <Select
          value={selectedType ?? ALL_TYPES_VALUE}
          onValueChange={(value) =>
            onTypesChange(value === ALL_TYPES_VALUE ? [] : [value as CalendarEventType])
          }
        >
          <SelectTrigger id="calendar-filter-type" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES_VALUE}>{t('filters.allTypes')}</SelectItem>
            {Object.values(CalendarEventType).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`types.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="calendar-filter-class"
          className="text-xs font-medium text-muted-foreground"
        >
          {t('filters.classLabel')}
        </label>
        <Select
          value={classId ?? ALL_CLASSES_VALUE}
          onValueChange={(value) =>
            onClassIdChange(value === ALL_CLASSES_VALUE ? undefined : value)
          }
        >
          <SelectTrigger id="calendar-filter-class" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLASSES_VALUE}>{t('filters.allClasses')}</SelectItem>
            {classOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
