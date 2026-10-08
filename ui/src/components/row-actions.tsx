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
  EllipsisVerticalIcon,
  EyeIcon,
  HandCoinsIcon,
  PencilIcon,
  PrinterIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

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
  /** The action's request is in flight: clicks are ignored, the control stays focusable. */
  busy?: boolean;
  /** Copied onto the rendered button/link as the `data-focus-anchor` attribute, so
   * `useRouteFocus`'s Back-navigation focus restore lands on the row (CONTRACT Addendum 7).
   * Pages pass `{ intent: 'view', …, 'data-focus-anchor': row.id }`. */
  'data-focus-anchor'?: string;
}

export interface RowActionsProps {
  actions: readonly RowAction[];
}

/** `DataTable` provides `'labelled'` in card mode (C12: phones show text, not bare icons). */
export const RowActionsLayoutContext = React.createContext<'icons' | 'labelled'>('icons');

type IconType = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

const INTENTS: Record<RowActionIntent, { icon: IconType; tone: string }> = {
  view: { icon: EyeIcon, tone: 'text-text-secondary' },
  print: { icon: PrinterIcon, tone: 'text-text-secondary' },
  download: { icon: DownloadIcon, tone: 'text-text-secondary' },
  duplicate: { icon: CopyIcon, tone: 'text-text-secondary' },
  archive: { icon: ArchiveIcon, tone: 'text-text-secondary' },
  edit: { icon: PencilIcon, tone: 'text-primary' },
  restore: { icon: ArchiveRestoreIcon, tone: 'text-primary' },
  send: { icon: SendIcon, tone: 'text-primary' },
  delete: { icon: Trash2Icon, tone: 'text-destructive' },
  remove: { icon: CircleMinusIcon, tone: 'text-destructive' },
  reject: { icon: CircleXIcon, tone: 'text-destructive' },
  pay: { icon: HandCoinsIcon, tone: 'text-status-paid-fg' },
  approve: { icon: CircleCheckIcon, tone: 'text-status-paid-fg' },
};

const ICON_BUTTON =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted md:size-8';
const LABELLED_BUTTON =
  'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-medium hover:bg-muted';

const MAX_INLINE = 3;

function ActionControl({ action, labelled }: { action: RowAction; labelled: boolean }) {
  const { icon: DefaultIcon, tone } = INTENTS[action.intent];
  const glyph = action.icon ?? <DefaultIcon className="size-4" aria-hidden />;
  const anchor = action['data-focus-anchor'];
  const className = cn(
    labelled ? LABELLED_BUTTON : ICON_BUTTON,
    tone,
    action.busy && 'cursor-wait opacity-50',
  );
  const content = (
    <>
      {glyph}
      {labelled && <span className="truncate">{action.label}</span>}
    </>
  );
  const control = action.to ? (
    <Link
      to={action.to}
      className={className}
      aria-label={labelled ? undefined : action.label}
      data-focus-anchor={anchor}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      aria-label={labelled ? undefined : action.label}
      aria-disabled={action.busy || undefined}
      aria-busy={action.busy || undefined}
      onClick={action.busy ? undefined : action.onClick}
      data-focus-anchor={anchor}
    >
      {content}
    </button>
  );
  if (labelled) return control;
  return (
    <Tooltip>
      {/* The tooltip repeats `aria-label`; don't announce it twice as a description. */}
      <TooltipTrigger asChild aria-describedby={undefined}>
        {control}
      </TooltipTrigger>
      <TooltipContent side="top">{action.label}</TooltipContent>
    </Tooltip>
  );
}

function MoreItem({ action }: { action: RowAction }) {
  const { icon: DefaultIcon, tone } = INTENTS[action.intent];
  const variant =
    action.intent === 'delete' || action.intent === 'remove' ? 'destructive' : 'default';
  const inner = (
    <>
      <span className={tone}>{action.icon ?? <DefaultIcon className="size-4" aria-hidden />}</span>
      {action.label}
    </>
  );
  if (action.to) {
    return (
      <MenuItem asChild variant={variant}>
        <Link to={action.to} data-focus-anchor={action['data-focus-anchor']}>
          {inner}
        </Link>
      </MenuItem>
    );
  }
  return (
    <MenuItem variant={variant} disabled={action.busy ?? false} onSelect={() => action.onClick?.()}>
      {inner}
    </MenuItem>
  );
}

export function RowActions({ actions }: RowActionsProps) {
  const { t } = useTranslation();
  const layout = React.useContext(RowActionsLayoutContext);
  const labelled = layout === 'labelled';
  const visible = actions.filter((action) => action.allowed !== false);
  if (visible.length === 0) return null;

  // More than 3: first 3 stay inline, the rest go in the menu with
  // delete/remove always last, after a separator.
  const overflow = visible.length > MAX_INLINE;
  const danger = overflow
    ? visible.filter((a) => a.intent === 'delete' || a.intent === 'remove')
    : [];
  const rest = overflow ? visible.filter((a) => !danger.includes(a)) : visible;
  const inline = overflow ? rest.slice(0, MAX_INLINE) : rest;
  const menuRest = overflow ? rest.slice(MAX_INLINE) : [];

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={labelled ? 'flex w-full items-center' : 'flex items-center justify-end gap-1'}
      >
        {inline.map((action, index) => (
          <ActionControl key={`${action.intent}-${index}`} action={action} labelled={labelled} />
        ))}
        {overflow && (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className={cn(ICON_BUTTON, 'text-text-secondary', labelled && 'flex-none')}
                aria-label={t('actions.moreActions')}
              >
                <EllipsisVerticalIcon className="size-4" aria-hidden />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              {menuRest.map((action, index) => (
                <MoreItem key={`${action.intent}-${index}`} action={action} />
              ))}
              {menuRest.length > 0 && danger.length > 0 && <MenuSeparator />}
              {danger.map((action, index) => (
                <MoreItem key={`${action.intent}-${index}`} action={action} />
              ))}
            </MenuContent>
          </Menu>
        )}
      </div>
    </TooltipProvider>
  );
}
