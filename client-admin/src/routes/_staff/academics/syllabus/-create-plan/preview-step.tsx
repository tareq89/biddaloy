/** Step 3: the lessons that will be saved. Untick a row to leave it out; nothing is saved before Save. */
import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import { CapacityNotice, type CapacityLine } from './start-step';

export interface PreviewRow {
  /** `c-<i>` carry-over, `s-<i>` from the chosen source. */
  key: string;
  title: string;
  periods: number;
  /** Term name for a carried-over lesson. */
  fromTerm?: string;
}

export function PreviewStep({
  rows,
  dropped,
  onToggle,
  capacity,
  empty,
  hiddenRows,
}: {
  rows: PreviewRow[];
  dropped: ReadonlySet<string>;
  onToggle: (key: string) => void;
  capacity: CapacityLine | null;
  empty: boolean;
  hiddenRows: number;
}) {
  const { t } = useTranslation('studyPlans');
  const regionConfig = useTenantRegionConfig();
  const kept = rows.filter((r) => !dropped.has(r.key));
  const periods = kept.reduce((sum, r) => sum + r.periods, 0);

  if (empty) {
    return <p className="text-text-secondary">{t('create.preview.emptyStart')}</p>;
  }

  return (
    <div className="space-y-4">
      {capacity && <CapacityNotice line={capacity} />}
      <p className="text-label text-text-secondary">
        {hiddenRows > 0
          ? t('create.preview.firstOf', {
              shown: formatNumber(rows.length, regionConfig),
              total: formatNumber(rows.length + hiddenRows, regionConfig),
            })
          : t('create.preview.summary', {
              lessons: formatNumber(kept.length, regionConfig),
              periods: formatNumber(periods, regionConfig),
            })}
      </p>
      <Table aria-label={t('create.steps.preview')}>
        <TableHeader>
          <TableRow className="border-y border-border-subtle bg-muted text-label text-text-secondary">
            <TableHead className="h-10 w-16 px-4 font-medium">{t('create.preview.keep')}</TableHead>
            <TableHead className="h-10 w-16 px-4 text-end font-medium">
              {t('create.preview.no')}
            </TableHead>
            <TableHead className="h-10 px-4 font-medium">{t('create.preview.title')}</TableHead>
            <TableHead className="h-10 px-4 text-end font-medium">
              {t('create.preview.periods')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-border-subtle">
          {rows.map((row, index) => (
            <TableRow key={row.key}>
              <TableCell className="px-4 py-2">
                <Checkbox
                  checked={!dropped.has(row.key)}
                  onCheckedChange={() => onToggle(row.key)}
                  aria-label={`${t('create.preview.keep')} ${row.title}`}
                />
              </TableCell>
              <TableCell className="px-4 py-2 text-end tabular-nums">
                {formatNumber(index + 1, regionConfig)}
              </TableCell>
              <TableCell className="px-4 py-2">
                <p className="font-medium">{row.title}</p>
                {row.fromTerm && (
                  <p className="text-caption text-text-secondary">
                    {t('create.preview.fromTerm', { term: row.fromTerm })}
                  </p>
                )}
              </TableCell>
              <TableCell className="px-4 py-2 text-end tabular-nums">
                {formatNumber(row.periods, regionConfig)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
