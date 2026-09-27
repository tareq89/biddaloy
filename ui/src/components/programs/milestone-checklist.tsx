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
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../popover';

export interface MilestoneChecklistItem {
  id: string;
  name: string;
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
    return emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null;
  }

  function handleKeyDown(event: React.KeyboardEvent, item: MilestoneChecklistItem) {
    if (event.key === ' ' && item.achievedOn === null) {
      event.preventDefault();
      onRecord(item.id);
    }
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const achieved = item.achievedOn !== null;
        return (
          <li key={item.id} data-milestone-id={item.id} className="flex items-center gap-2">
            {achieved ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked="true"
                    data-milestone-id={item.id}
                    className="flex flex-1 items-center gap-2 rounded-md p-1 text-start"
                  >
                    <span aria-hidden="true">☑</span>
                    <span className="flex-1">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.achievedOn}
                      {item.scoreGrade ? ` · ${item.scoreGrade}` : ''}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  {item.remark && <p className="text-sm">{item.remark}</p>}
                  <button
                    type="button"
                    className="text-sm font-medium text-destructive underline"
                    onClick={() => onUndo(item.id)}
                  >
                    {undoLabel}
                  </button>
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
                className="flex flex-1 items-center gap-2 rounded-md p-1 text-start"
              >
                <span aria-hidden="true">☐</span>
                <span className="flex-1">{item.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
