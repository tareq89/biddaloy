/**
 * [16.3.6] The Generate Fees modal's "Fees" section — a checkbox list of
 * the fee structures defined for the chosen academic year. Structures
 * whose `class_id` matches the majority class among the currently
 * selected students float to the top, since that's the fee set an
 * accountant generating for "class 9" almost always wants checked first —
 * a tenant-wide structure (`class_id: null`) sorts after every
 * class-matching one, then everything else keeps the server's own order.
 */
import { Checkbox } from '@biddaloy/ui/components';
import { feeStructuresQueryOptions, type FeeStructure } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatServerAmount, parseCurrency } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';

export interface FeePickerProps {
  academicYearId: string;
  majorityClassId: string | undefined;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
  studentCount: number;
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
  majorityClassId,
  selected,
  onSelectedChange,
  studentCount,
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
  // summing so `runningTotal` can go straight into `formatCurrency` below
  // without every intermediate sum re-triggering its own integer check.
  const runningTotal = structures
    .filter((structure) => selected.has(structure.id))
    .reduce((sum, structure) => sum + parseCurrency(String(structure.amount), config), 0);

  function toggle(structure: FeeStructure, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(structure.id);
    else next.delete(structure.id);
    onSelectedChange(next);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="fee-picker">
      <span className="text-sm font-medium">{t('fees.heading')}</span>

      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-2">
        {structuresQuery.isPending && (
          <li className="text-sm text-muted-foreground">{t('fees.loading')}</li>
        )}
        {structuresQuery.isSuccess && structures.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('fees.empty')}</li>
        )}
        {structures.map((structure) => (
          <li key={structure.id} className="flex items-center justify-between gap-2 px-1 py-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(structure.id)}
                onCheckedChange={(checked) => toggle(structure, checked === true)}
                aria-label={structure.name}
              />
              {structure.name}
            </label>
            <span className="text-xs text-muted-foreground">
              {formatServerAmount(structure.amount, config)}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground">
        {t('fees.runningTotal', {
          amount: formatCurrency(runningTotal, config),
          count: studentCount,
        })}
      </p>
    </div>
  );
}
