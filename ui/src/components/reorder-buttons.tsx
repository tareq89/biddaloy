/**
 * [66.1.06] ↑ ↓ buttons for a row in an ordered list. Labels are props (the
 * caller puts the row's number in them). Alt+↑/↓ on the row stays in the page.
 */
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';

import { Button } from './button';

const ICON_BUTTON = 'size-11 text-text-secondary md:size-8';

export interface ReorderButtonsProps {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  upLabel: string;
  downLabel: string;
}

export function ReorderButtons({ index, count, onMove, upLabel, downLabel }: ReorderButtonsProps) {
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        iconOnly
        aria-label={upLabel}
        className={ICON_BUTTON}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        aria-label={downLabel}
        className={ICON_BUTTON}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </div>
  );
}
