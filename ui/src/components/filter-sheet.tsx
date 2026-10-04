/**
 * D24: phone filter sheet. Stub — filled in by 31.2.7 (bottom-sheet placement,
 * 44 px close, the trigger).
 */
import type * as React from 'react';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Dialog, DialogContent, DialogTitle } from './dialog';

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default `t('filters.showFiltersNone')` ("Filters"). */
  title?: string;
  /** Footer primary label: plural "show N results", or the plain "show results" when unknown. */
  resultCount?: number;
  onClearAll: () => void;
  /** The fields, full width, each with its label. */
  children: React.ReactNode;
}

export function FilterSheet({
  open,
  onOpenChange,
  title,
  resultCount,
  onClearAll,
  children,
}: FilterSheetProps) {
  const { t } = useTranslation('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title ?? t('filters.showFiltersNone')}</DialogTitle>
        <div className="flex flex-col gap-4">{children}</div>
        <div className="flex gap-2 border-t border-border-subtle p-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClearAll}>
            {t('filters.clearAll')}
          </Button>
          <Button type="button" className="flex-1" onClick={() => onOpenChange(false)}>
            {resultCount === undefined
              ? t('filters.showResultsNone')
              : t('filters.showResults', { count: resultCount })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
