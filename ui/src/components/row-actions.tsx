/**
 * D19: intent-keyed row actions for tables (patterns.md section 4). Types are
 * final; stub body — filled in by 31.2.4a (colours, tooltip, More menu, phone).
 */
import { Link } from '@tanstack/react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  HandCoinsIcon,
  PencilIcon,
  PrinterIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import type * as React from 'react';

import { Button } from './button';

export type RowActionIntent =
  | 'view'
  | 'edit'
  | 'delete'
  | 'remove'
  | 'print'
  | 'download'
  | 'pay'
  | 'approve'
  | 'reject'
  | 'duplicate'
  | 'archive'
  | 'restore'
  | 'send';

export interface RowAction {
  intent: RowActionIntent;
  label: string;
  onClick?: () => void;
  to?: string;
  allowed?: boolean;
  icon?: React.ReactNode;
  /** Copied onto the rendered button/link as the `data-focus-anchor` attribute, so
   * `useRouteFocus`'s Back-navigation focus restore lands on the row (CONTRACT Addendum 7).
   * Pages pass `{ intent: 'view', …, 'data-focus-anchor': row.id }`. */
  'data-focus-anchor'?: string;
}

export interface RowActionsProps {
  actions: RowAction[];
}

const DEFAULT_ICON: Record<RowActionIntent, React.ComponentType<{ 'aria-hidden'?: boolean }>> = {
  view: EyeIcon,
  edit: PencilIcon,
  delete: Trash2Icon,
  remove: CircleMinusIcon,
  print: PrinterIcon,
  download: DownloadIcon,
  pay: HandCoinsIcon,
  approve: CircleCheckIcon,
  reject: CircleXIcon,
  duplicate: CopyIcon,
  archive: ArchiveIcon,
  restore: ArchiveRestoreIcon,
  send: SendIcon,
};

export function RowActions({ actions }: RowActionsProps) {
  return (
    <div className="flex justify-end">
      {actions
        .filter((action) => action.allowed !== false)
        .map((action, index) => {
          const DefaultIcon = DEFAULT_ICON[action.intent];
          const icon = action.icon ?? <DefaultIcon aria-hidden />;
          const anchor = action['data-focus-anchor'];
          if (action.to) {
            return (
              <Button
                key={`${action.intent}-${index}`}
                asChild
                variant="ghost"
                size="icon"
                iconOnly
                aria-label={action.label}
              >
                <Link to={action.to} data-focus-anchor={anchor}>
                  {icon}
                </Link>
              </Button>
            );
          }
          return (
            <Button
              key={`${action.intent}-${index}`}
              type="button"
              variant="ghost"
              size="icon"
              iconOnly
              aria-label={action.label}
              onClick={action.onClick}
              data-focus-anchor={anchor}
            >
              {icon}
            </Button>
          );
        })}
    </div>
  );
}
