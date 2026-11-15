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
  /** Source sections seen so far; the picker shows only when there is more than one. */
  sections?: readonly { id: string; name: string }[];
  values: Record<string, string>;
  onChange: (patch: Record<string, string | null>) => void;
  resultCount?: number;
}

export function GroupsFilterBar({
  subjects,
  sections = [],
  values,
  onChange,
  resultCount,
}: GroupsFilterBarProps) {
  const { t } = useTranslation('promotions');
  const fields: FilterFieldDescriptor[] = [
    ...(sections.length > 1
      ? [
          {
            kind: 'select' as const,
            key: 'section_id',
            label: t('groups.filters.section'),
            allLabel: t('groups.filters.sectionAll'),
            options: sections.map((s) => ({ value: s.id, label: s.name })),
          },
        ]
      : []),
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
  const sectionId = values.section_id || undefined;
  const marksMin = subject ? num(values.marks_min) : undefined;
  return {
    ...(sectionId ? { section_id: sectionId } : {}),
    ...(gpaMin === undefined ? {} : { gpa_min: gpaMin }),
    ...(gpaMax === undefined ? {} : { gpa_max: gpaMax }),
    ...(subject ? { subject_code: subject } : {}),
    ...(marksMin === undefined ? {} : { marks_min: marksMin }),
  };
}
