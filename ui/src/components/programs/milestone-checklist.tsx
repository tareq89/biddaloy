/**
 * [34.4.1] One student's milestones for one program, as a checkbox list —
 * the expanded content under a Students-tab row. `Space` on an unticked
 * row calls `onRecord` (D9: keyboard-only, no click needed); a ticked row
 * opens a small popover offering Undo, which the caller wires to
 * `useRemoveAchievement`. Focus stays on the row's own checkbox after the
 * record dialog closes or Undo runs — the caller re-focuses
 * `rowRefs.current[milestoneId]` itself (this component only exposes
 * `data-milestone-id` for that), since focus restoration after a dialog
 * closes is a route-level concern, not this list's.
 *
 * i18n is prop-driven — every string here is passed in already translated,
 * same convention as `StatusBadge`/`EmptyState`.
 */
import { CheckIcon, RotateCcwIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '../button';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';

export interface MilestoneChecklistItem {
  id: string;
  name: string;
  /** Already formatted by the caller (`formatDate`) — shown as-is. */
  achievedOn: string | null;
  scoreGrade: string | null;
  remark: string | null;
}

export interface MilestoneChecklistProps {
  items: readonly MilestoneChecklistItem[];
  onRecord: (milestoneId: string) => void;
  onUndo: (milestoneId: string) => void;
  undoLabel: string;
  emptyMessage?: string;
}

export function MilestoneChecklist({
  items,
  onRecord,
  onUndo,
  undoLabel,
  emptyMessage,
}: MilestoneChecklistProps) {
  if (items.length === 0) {
    return emptyMessage ? <p className="text-body text-text-secondary">{emptyMessage}</p> : null;
  }

  function handleKeyDown(event: React.KeyboardEvent, item: MilestoneChecklistItem) {
    if (event.key === ' ' && item.achievedOn === null) {
      event.preventDefault();
      onRecord(item.id);
    }
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const achieved = item.achievedOn !== null;
        return (
          <li key={item.id} data-milestone-id={item.id} className="flex items-center">
            {achieved ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked="true"
                    data-milestone-id={item.id}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-muted md:min-h-8"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground"
                    >
                      <CheckIcon className="size-3.5" />
                    </span>
                    <span className="flex-1">{item.name}</span>
                    <span className="text-caption text-text-secondary">
                      {item.achievedOn}
                      {item.scoreGrade ? ` · ${item.scoreGrade}` : ''}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  {item.remark && <p className="text-body text-text-primary">{item.remark}</p>}
                  <Button type="button" variant="ghost" onClick={() => onUndo(item.id)}>
                    <RotateCcwIcon aria-hidden="true" />
                    {undoLabel}
                  </Button>
                </PopoverContent>
              </Popover>
            ) : (
              <button
                type="button"
                role="checkbox"
                aria-checked="false"
                data-milestone-id={item.id}
                onClick={() => onRecord(item.id)}
                onKeyDown={(event) => handleKeyDown(event, item)}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-muted md:min-h-8"
              >
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-functional bg-surface"
                />
                <span className="flex-1">{item.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
