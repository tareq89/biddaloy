/**
 * [38.4.3] Filter descriptors for the `/fees/fines` list — `month, class_id,
 * section_id, fee_structure_id, origin, status` per the ticket's step 1/2.
 * `section_id`'s options stay empty until `class_id` is chosen, same
 * contract `fees/dues.tsx`'s pair documents; `fee_structure_id` is scoped
 * to `FeeType.FINE` structures only (the filter/columns are about fines,
 * not the whole fee catalog).
 *
 * Every `t()`/`tCommon()` call below carries an explicit `{ ns }` —
 * `check-i18n-keys.mjs` resolves a call's namespace from the nearest
 * `useTranslation(ns)` in the *same file*, and this file has none (its `t`
 * is a parameter, not a hook call), so it would otherwise default to
 * `common` and fail every key here.
 */
import { FeeStatus, FeeType } from '@biddaloy/shared';
import { statusLabelKey } from '@biddaloy/ui/components';
import type { FeeStructure } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import type { FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatMonthName } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';

export interface FinesFilterSources {
  classes: { id: string; name: string }[];
  sections: { id: string; section_name: string }[];
  fineStructures: FeeStructure[];
  regionConfig: RegionConfig;
}

/** `t` is the `fines` namespace's own `t` for every fines-only label, plus
 * a second, `common`-bound `t` for the shared fee-status labels
 * `statusLabelKey` points at — same split `fees/dues.tsx` uses. */
export function buildFinesFilterFields(
  t: TFunction<'fines', undefined>,
  tCommon: TFunction<'common', undefined>,
  { classes, sections, fineStructures, regionConfig }: FinesFilterSources,
): FilterFieldDescriptor[] {
  return [
    {
      kind: 'select',
      key: 'month',
      label: t('filters.monthLabel', { ns: 'fines' }),
      allLabel: t('filters.allMonths', { ns: 'fines' }),
      options: Array.from({ length: 12 }, (_, index) => ({
        value: String(index + 1),
        label: formatMonthName(index + 1, regionConfig),
      })),
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('filters.classLabel', { ns: 'fines' }),
      allLabel: t('filters.allClasses', { ns: 'fines' }),
      options: classes.map((klass) => ({ value: klass.id, label: klass.name })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('filters.sectionLabel', { ns: 'fines' }),
      allLabel: t('filters.allSections', { ns: 'fines' }),
      options: sections.map((section) => ({ value: section.id, label: section.section_name })),
    },
    {
      kind: 'select',
      key: 'fee_structure_id',
      label: t('filters.fineTypeLabel', { ns: 'fines' }),
      allLabel: t('filters.allFineTypes', { ns: 'fines' }),
      options: fineStructures.map((structure) => ({ value: structure.id, label: structure.name })),
    },
    {
      kind: 'select',
      key: 'origin',
      label: t('filters.originLabel', { ns: 'fines' }),
      allLabel: t('filters.allOrigins', { ns: 'fines' }),
      options: [
        { value: 'RULE', label: t('origin.RULE', { ns: 'fines' }) },
        { value: 'MANUAL', label: t('origin.MANUAL', { ns: 'fines' }) },
      ],
    },
    {
      kind: 'select',
      key: 'status',
      label: t('filters.statusLabel', { ns: 'fines' }),
      allLabel: t('filters.allStatuses', { ns: 'fines' }),
      options: [
        FeeStatus.PENDING,
        FeeStatus.PARTIALLY_PAID,
        FeeStatus.PAID,
        FeeStatus.OVERDUE,
        FeeStatus.WAIVED,
      ].map((status) => ({
        value: status,
        label: tCommon(statusLabelKey('fee', status), { ns: 'common' }),
      })),
    },
  ];
}

// Re-exported so `index.tsx` and its test don't each redeclare it.
export const FINE_FEE_TYPE = FeeType.FINE;
