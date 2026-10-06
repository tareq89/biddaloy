/**
 * D19: "Showing 1–20 of 134" / "Total 134" line under a table. Final body;
 * 31.2.4b wires it into DataTable.
 */
import { useRegionConfig, useTranslation } from '../i18n';
import { formatNumber } from '../utils/number';

export interface TableCountProps {
  total: number;
  from?: number;
  to?: number;
}

export function TableCount({ total, from, to }: TableCountProps) {
  const { t } = useTranslation('common');
  const regionConfig = useRegionConfig();
  return (
    <p data-slot="table-count" className="text-text-secondary">
      {from !== undefined && to !== undefined
        ? t('pagination.range', {
            start: formatNumber(from, regionConfig),
            end: formatNumber(to, regionConfig),
            total: formatNumber(total, regionConfig),
          })
        : // `count` picks the plural form; `total` is the grouped display text.
          t('table.total', { count: total, total: formatNumber(total, regionConfig) })}
    </p>
  );
}
