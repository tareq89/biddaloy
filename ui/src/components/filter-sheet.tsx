/**
 * D24: the phone filter sheet — a bottom sheet holding every filter field full
 * width. Filters apply live as they change, so the footer's primary button only
 * closes the sheet and tells the user how many results they now have.
 * No sheet primitive exists in `ui`, so this builds on Radix Dialog the same way
 * `primitives/dialog.tsx` does (focus trap, Esc, focus return are Radix's).
 */
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';

import { useTranslation } from '../i18n';
import { DialogOverlay, DialogPortal } from '../primitives/dialog';

import { Button } from './button';

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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-lg bg-surface pb-(--safe-area-bottom) text-body text-text-primary shadow-e3 outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
        >
          <div className="flex items-center justify-between py-1.5 ps-4 pe-1.5">
            <DialogPrimitive.Title className="text-h2">
              {title ?? t('filters.showFiltersNone')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                className="size-11"
                aria-label={t('actions.close')}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">{children}</div>
          <div className="flex gap-2 border-t border-border-subtle p-4">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClearAll}>
              {t('filters.clearAll')}
            </Button>
            <Button type="button" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
              {resultCount === undefined
                ? t('filters.showResultsNone')
                : t('filters.showResults', { count: resultCount })}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
