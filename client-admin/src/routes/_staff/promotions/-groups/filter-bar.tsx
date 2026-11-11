/**
 * [69.5.01] Marks filter for the groups page (T3): GPA range, then a subject and the least
 * marks in it. Wraps the kit `FilterBar` (phone: "Filters (n)" opens a sheet). Values are the
 * raw strings the kit keeps; `toGroupFilters` turns them into the server's query.
 */
import type { PromotionGroupFilters } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar as KitFilterBar, type FilterFieldDescriptor } from '@biddaloy/ui/shells';

export interface GroupsFilterBarProps {
  /** Subject codes of the shown results. */
  subjects: readonly string[];
  values: Record<string, string>;
  onChange: (patch: Record<string, string | null>) => void;
  resultCount?: number;
}

export function GroupsFilterBar({ subjects, values, onChange, resultCount }: GroupsFilterBarProps) {
  const { t } = useTranslation('promotions');
  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'number-range',
      minKey: 'gpa_min',
      maxKey: 'gpa_max',
      label: t('groups.filters.gpa'),
      minLabel: t('groups.filters.gpaMin'),
      maxLabel: t('groups.filters.gpaMax'),
    },
    {
      kind: 'select',
      key: 'subject_code',
      label: t('groups.filters.subject'),
      allLabel: t('groups.filters.subjectAll'),
      options: subjects.map((code) => ({ value: code, label: code })),
    },
    { kind: 'text', key: 'marks_min', label: t('groups.filters.marksMin') },
  ];
  return (
    <KitFilterBar
      fields={fields}
      values={values}
      onChange={onChange}
      {...(resultCount === undefined ? {} : { resultCount })}
    />
  );
}

/** `marks_min` only counts with a subject (the server rejects it alone); junk numbers are dropped. */
export function toGroupFilters(values: Record<string, string>): PromotionGroupFilters {
  const num = (raw: string | undefined) => {
    if (raw === undefined || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const gpaMin = num(values.gpa_min);
  const gpaMax = num(values.gpa_max);
  const subject = values.subject_code || undefined;
  const marksMin = subject ? num(values.marks_min) : undefined;
  return {
    ...(gpaMin === undefined ? {} : { gpa_min: gpaMin }),
    ...(gpaMax === undefined ? {} : { gpa_max: gpaMax }),
    ...(subject ? { subject_code: subject } : {}),
    ...(marksMin === undefined ? {} : { marks_min: marksMin }),
  };
}
