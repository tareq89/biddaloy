/**
 * [66.1.06] ↑ ↓ buttons for a row in an ordered list. Labels are props (the
 * caller puts the row's number in them). Alt+↑/↓ on the row stays in the page.
 * At an end the button is `aria-disabled`, not `disabled`: moving a row to the
 * top must not drop keyboard focus to `<body>`.
 */
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';

import { Button } from './button';

const ICON_BUTTON =
  'size-11 text-text-secondary md:size-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

export interface ReorderButtonsProps {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  upLabel: string;
  downLabel: string;
}

export function ReorderButtons({ index, count, onMove, upLabel, downLabel }: ReorderButtonsProps) {
  const atTop = index === 0;
  const atBottom = index === count - 1;
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        iconOnly
        aria-label={upLabel}
        className={ICON_BUTTON}
        aria-disabled={atTop || undefined}
        onClick={atTop ? undefined : () => onMove(index, index - 1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        aria-label={downLabel}
        className={ICON_BUTTON}
        aria-disabled={atBottom || undefined}
        onClick={atBottom ? undefined : () => onMove(index, index + 1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </div>
  );
}
