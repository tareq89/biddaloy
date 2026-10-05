/**
 * D16: page title, subtitle and tiered action row. At most one filled
 * (primary) + two outline buttons inline on desktop; everything else goes
 * into a "More actions" menu. On phone only the primary stays inline (it
 * fills the row) and every other action moves into the menu.
 */
import { EllipsisIcon } from 'lucide-react';
import type * as React from 'react';

import { Button } from '../components/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../components/menu';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

export type PageActionPriority = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface PageAction {
  id: string;
  label: string;
  onClick: () => void;
  /** Defaults to `true` — set `false` to hide an action the user may not take. */
  allowed?: boolean;
  /** Defaults to `'secondary'`. */
  priority?: PageActionPriority;
  icon?: React.ReactNode;
  /** Stays visible, not clickable (e.g. Save with no changes). */
  disabled?: boolean;
  /** Button `loading` (spinner + `aria-busy`, label kept). */
  busy?: boolean;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string | undefined;
  actions?: readonly PageAction[] | undefined;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-6 md:gap-y-3">
      <div className="min-w-0 md:min-w-48">
        <h1 className="text-h1">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-text-secondary">{subtitle}</p>}
      </div>
      <PageHeaderActions actions={actions} />
    </header>
  );
}

export function PageHeaderActions({
  actions = [],
}: {
  actions?: readonly PageAction[] | undefined;
}) {
  const { t } = useTranslation();
  const visible = actions.filter((a) => a.allowed !== false);
  if (visible.length === 0) return null;

  const tier = (p: PageActionPriority) => visible.filter((a) => (a.priority ?? 'secondary') === p);
  const primary = tier('primary');
  const secondary = tier('secondary');
  const tertiary = tier('tertiary');
  const destructive = tier('destructive');

  if (process.env.NODE_ENV !== 'production' && primary.length > 1) {
    // Not a thrown error: permission gating must never crash a page.
    console.warn(
      `PageHeader: ${primary.length} actions declared priority "primary" (${primary
        .map((a) => a.id)
        .join(', ')}). Design contract allows at most one.`,
    );
  }

  const menuBase = [...secondary.slice(2), ...tertiary];
  // A lone destructive with nothing else to share a menu with stays inline.
  const destructiveInline =
    menuBase.length === 0 && secondary.length < 2 ? destructive.slice(0, 2 - secondary.length) : [];
  const destructiveMenu = destructive.filter((a) => !destructiveInline.includes(a));
  const inlineOthers = [...secondary.slice(0, 2), ...destructiveInline];
  const desktopMenuEmpty = menuBase.length === 0 && destructiveMenu.length === 0;
  const hasMenu = inlineOthers.length > 0 || !desktopMenuEmpty;

  const variantOf = (a: PageAction) =>
    a.priority === 'primary'
      ? ('default' as const)
      : a.priority === 'destructive'
        ? ('destructive' as const)
        : ('outline' as const);

  const button = (a: PageAction, className = '') => (
    <Button
      key={a.id}
      type="button"
      variant={variantOf(a)}
      data-action-id={a.id}
      disabled={a.disabled ?? false}
      loading={a.busy ?? false}
      onClick={a.onClick}
      className={className}
    >
      {a.icon}
      {a.label}
    </Button>
  );

  const item = (a: PageAction, className = '') => (
    <MenuItem
      key={a.id}
      variant={a.priority === 'destructive' ? 'destructive' : 'default'}
      disabled={(a.disabled ?? false) || (a.busy ?? false)}
      className={className}
      onSelect={a.onClick}
    >
      {a.icon}
      {a.label}
    </MenuItem>
  );

  return (
    <div className="flex w-full items-center gap-2 md:w-auto md:shrink-0">
      {inlineOthers.map((a) => button(a, cn('hidden md:inline-flex')))}
      {hasMenu && (
        <Menu>
          <MenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              iconOnly
              aria-label={t('actions.moreActions')}
              className={desktopMenuEmpty ? 'md:hidden' : ''}
            >
              <EllipsisIcon />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {inlineOthers.map((a) => item(a, 'md:hidden'))}
            {menuBase.map((a) => item(a))}
            {menuBase.length > 0 && destructiveMenu.length > 0 && <MenuSeparator />}
            {destructiveMenu.map((a) => item(a))}
          </MenuContent>
        </Menu>
      )}
      {primary.map((a) => button(a, 'flex-1 md:flex-none'))}
    </div>
  );
}
