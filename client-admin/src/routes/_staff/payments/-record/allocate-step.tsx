/**
 * FIFO-prefilled, per-line editable allocation table — [8.10.5]'s core
 * AC. `-record-payment-wizard.tsx` owns the actual allocation math
 * (`allocation-math.ts`); this component is presentational only, so the
 * math stays unit-testable without a DOM.
 */
import {
  MoneyInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';

import type { AllocationLine, AllocationSummary, AllocationType } from './allocation-math';

export interface AllocateStepProps {
  lines: readonly AllocationLine[];
  summary: AllocationSummary;
  totalMinorUnits: number;
  onLineChange: (studentFeeId: string, minorUnits: number | undefined) => void;
}

const ALLOCATION_TYPE_KEY: Record<AllocationType, string> = {
  DUE: 'record.allocate.typeDue',
  CURRENT: 'record.allocate.typeCurrent',
  ADVANCE: 'record.allocate.typeAdvance',
};

export function AllocateStep({ lines, summary, totalMinorUnits, onLineChange }: AllocateStepProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('record.allocate.columnPeriod')}</TableHead>
            <TableHead>{t('record.allocate.columnType')}</TableHead>
            <TableHead>{t('record.allocate.columnRemaining')}</TableHead>
            <TableHead>{t('record.allocate.columnAllocated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.studentFeeId}>
              <TableCell>
                {line.year}-{String(line.month).padStart(2, '0')}
              </TableCell>
              <TableCell>{t(ALLOCATION_TYPE_KEY[line.allocationType])}</TableCell>
              <TableCell>{formatCurrency(line.remainingMinorUnits, config)}</TableCell>
              <TableCell>
                <MoneyInput
                  aria-label={t('record.allocate.lineAmountLabel', {
                    month: line.month,
                    year: line.year,
                  })}
                  value={line.allocatedMinorUnits}
                  onValueChange={(value) => onLineChange(line.studentFeeId, value)}
                  disabled={line.locked}
                  config={config}
                />
                {line.locked && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('record.allocate.lineLocked')}
                  </p>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div aria-live="polite" className="text-sm font-medium">
        {t('record.allocate.runningTotal', {
          allocated: formatCurrency(summary.allocatedMinorUnits, config),
          total: formatCurrency(totalMinorUnits, config),
          unallocated: formatCurrency(Math.max(0, summary.unallocatedMinorUnits), config),
        })}
      </div>

      {summary.overAllocated && (
        <p role="alert" className="text-sm text-destructive">
          {t('record.allocate.overAllocated', {
            over: formatCurrency(-summary.unallocatedMinorUnits, config),
          })}
        </p>
      )}
    </div>
  );
}
