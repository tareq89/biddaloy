/**
 * [16.3.6] The Generate Fees full-page form's "Fees" card — a checkbox list of
 * the fee structures defined for the chosen academic year. Structures
 * whose `class_id` matches the majority class among the currently
 * selected students float to the top, since that's the fee set an
 * accountant generating for "class 9" almost always wants checked first —
 * a tenant-wide structure (`class_id: null`) sorts after every
 * class-matching one, then everything else keeps the server's own order.
 */
import { Card, Checkbox } from '@biddaloy/ui/components';
import { feeStructuresQueryOptions, type FeeStructure } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatServerAmount, parseCurrency } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';

export interface FeePickerProps {
  academicYearId: string;
  /** The chosen academic year's name, for the card's description. */
  academicYearName: string;
  majorityClassId: string | undefined;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
}

function sortStructures(structures: FeeStructure[], majorityClassId: string | undefined) {
  return [...structures].sort((a, b) => {
    const aMatches = majorityClassId !== undefined && a.class_id === majorityClassId;
    const bMatches = majorityClassId !== undefined && b.class_id === majorityClassId;
    if (aMatches !== bMatches) return aMatches ? -1 : 1;
    return 0;
  });
}

export function FeePicker({
  academicYearId,
  academicYearName,
  majorityClassId,
  selected,
  onSelectedChange,
}: FeePickerProps) {
  const { t } = useTranslation('feeGeneration');
  const config = useRegionConfig();
  // `enabled` gates the request instead of a fake `limit: 0` — the server
  // rejects `limit` below 1 (`@Min(1)` on `QueryFeeStructuresDto`), so the
  // old placeholder 400ed whenever no academic year was picked yet.
  const structuresQuery = useQuery({
    ...feeStructuresQueryOptions({ academic_year_id: academicYearId, limit: 100 }),
    enabled: academicYearId !== '',
  });
  const structures = sortStructures(structuresQuery.data?.data ?? [], majorityClassId);

  // `structure.amount` is a server decimal ("500" or "500.00"), same
  // shape `fee-structures/index.tsx`'s own list column reads with
  // `formatServerAmount` — not minor units. Parsed to minor units before
  // summing so the total can go straight into `formatCurrency` below
  // without every intermediate sum re-triggering its own integer check.
  const perStudentTotal = structures
    .filter((structure) => selected.has(structure.id))
    .reduce((sum, structure) => sum + parseCurrency(String(structure.amount), config), 0);

  function toggle(structure: FeeStructure, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(structure.id);
    else next.delete(structure.id);
    onSelectedChange(next);
  }

  return (
    <Card padded data-testid="fee-picker">
      <h2 className="text-h2">{t('fees.heading')}</h2>
      <p className="mt-0.5 text-text-secondary">
        {t('fees.description', { year: academicYearName })}
      </p>

      <ul className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle">
        {structuresQuery.isPending && (
          <li className="px-3 py-3 text-text-secondary">{t('fees.loading')}</li>
        )}
        {structuresQuery.isSuccess && structures.length === 0 && (
          <li className="px-3 py-3 text-text-secondary">{t('fees.empty')}</li>
        )}
        {structures.map((structure) => (
          <li key={structure.id} className="px-3">
            <label className="flex min-h-11 items-center gap-3 md:min-h-9">
              <Checkbox
                checked={selected.has(structure.id)}
                onCheckedChange={(checked) => toggle(structure, checked === true)}
              />
              <span className="min-w-0 flex-1">{structure.name}</span>
              <span className="ms-auto shrink-0 text-text-secondary tabular-nums">
                {formatServerAmount(structure.amount, config)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-text-secondary">
        {t('fees.perStudent', { amount: formatCurrency(perStudentTotal, config) })}
      </p>
    </Card>
  );
}
