/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the row and panel only delegate keys from their own focusable controls */
/**
 * [169.2-11] The widget list of customise mode. Keyboard (D12): Space toggles
 * the focused checkbox, Alt+Up/Down moves a shown row and keeps focus on it,
 * Enter saves, Esc cancels. Every change is announced in one polite live
 * region. No drag (D12 "extra only").
 */
import { WIDGET_CATALOGUE, type DashboardWidgetKey, type UserRole } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import * as React from 'react';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';
import type { LayoutItem } from '../resolve-layout';

import { customiseReducer, type DraftAction, type DraftState } from './customise-draft';

export interface CustomisePanelProps {
  draft: DraftState;
  role: UserRole;
  onAction: (action: DraftAction) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  saving?: boolean;
  error?: unknown;
  /** The preview lights the card of the row that has focus. */
  onFocusRow?: (key: DashboardWidgetKey | null) => void;
}

export function CustomisePanel({
  draft,
  role,
  onAction,
  onSave,
  onCancel,
  onReset,
  saving = false,
  error,
  onFocusRow,
}: CustomisePanelProps) {
  const { t } = useTranslation('dashboard');
  const { t: tAuth } = useTranslation('auth');
  const [announcement, setAnnouncement] = React.useState('');
  const boxes = React.useRef(new Map<DashboardWidgetKey, HTMLButtonElement>());
  const refocus = React.useRef<DashboardWidgetKey | null>(null);

  // A row that changes list remounts; put focus back on it after the update.
  React.useLayoutEffect(() => {
    if (refocus.current) boxes.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  const title = (key: DashboardWidgetKey) => t(`widgets.${key}.title`);

  const apply = (action: DraftAction & { key: DashboardWidgetKey }) => {
    const next = customiseReducer(draft, action);
    if (next === draft) return;
    onAction(action);
    refocus.current = action.key;
    const name = title(action.key);
    if (action.type === 'move') {
      setAnnouncement(
        t('customise.moved', {
          title: name,
          position: next.shown.findIndex((i) => i.key === action.key) + 1,
        }),
      );
    } else if (action.type === 'toggle') {
      const nowShown = next.shown.some((i) => i.key === action.key);
      setAnnouncement(t(nowShown ? 'customise.shownNow' : 'customise.hiddenNow', { title: name }));
    }
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') {
      // An open size select closes itself first.
      if (target.closest('[role="listbox"]') || target.getAttribute('aria-expanded') === 'true') {
        return;
      }
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter') {
      // Buttons and the size select keep Enter for themselves; a checkbox does not.
      const isButton = target.closest('button') && target.getAttribute('role') !== 'checkbox';
      if (isButton || target.closest('[role="listbox"]')) return;
      e.preventDefault();
      // Save is disabled while saving; Enter must not send a second PATCH.
      if (!saving) onSave();
    }
  };

  const row = (item: LayoutItem, index: number, isShown: boolean) => {
    const name = title(item.key);
    const entry = WIDGET_CATALOGUE[item.key];
    const checkId = `customise-${item.key}`;
    return (
      <li
        key={item.key}
        onFocus={() => onFocusRow?.(item.key)}
        onBlur={() => onFocusRow?.(null)}
        onKeyDown={(e) => {
          if (isShown && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            apply({ type: 'move', key: item.key, dir: e.key === 'ArrowUp' ? -1 : 1 });
          }
        }}
        className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1 focus-within:bg-secondary"
      >
        <Checkbox
          id={checkId}
          // [#3144] axe target-size: the 16px box beside its own label needs a 24px target.
          className="size-6"
          ref={(el: HTMLButtonElement | null) => {
            if (el) boxes.current.set(item.key, el);
            else boxes.current.delete(item.key);
          }}
          checked={isShown}
          onCheckedChange={() => apply({ type: 'toggle', key: item.key })}
        />
        <label htmlFor={checkId} className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          <span className="hidden truncate text-label text-muted-foreground md:block">
            {t(`widgets.${item.key}.description`)}
          </span>
        </label>
        <div className="hidden md:block">
          <Select
            value={item.size}
            onValueChange={(size) =>
              apply({ type: 'resize', key: item.key, size: size as LayoutItem['size'] })
            }
          >
            <SelectTrigger
              aria-label={t('customise.size.label', { title: name })}
              className="w-28"
              disabled={entry.sizes.length < 2}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entry.sizes.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`customise.size.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="icon"
          aria-label={t('customise.moveUp', { title: name })}
          disabled={!isShown || index === 0}
          onClick={() => apply({ type: 'move', key: item.key, dir: -1 })}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="icon"
          aria-label={t('customise.moveDown', { title: name })}
          disabled={!isShown || index === draft.shown.length - 1}
          onClick={() => apply({ type: 'move', key: item.key, dir: 1 })}
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
      </li>
    );
  };

  return (
    <section
      aria-labelledby="customise-panel-title"
      onKeyDown={onPanelKeyDown}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 max-md:-mx-4 max-md:rounded-t-2xl max-md:rounded-b-none md:p-5"
    >
      <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-muted md:hidden" />
      <h2 id="customise-panel-title" className="text-h2">
        {t('customise.panelTitle')}
      </h2>
      <p className="text-text-secondary">
        {t('customise.summary', {
          total: draft.shown.length + draft.hidden.length,
          shown: draft.shown.length,
          role: tAuth(`schoolPicker.roles.${role}`),
        })}
      </p>
      <div>
        <h3 className="mb-1 text-h3">
          {t('customise.shownHeading', { count: draft.shown.length })}
        </h3>
        <ol>{draft.shown.map((item, i) => row(item, i, true))}</ol>
      </div>
      <div>
        <h3 className="mb-1 text-h3">
          {t('customise.hiddenHeading', { count: draft.hidden.length })}
        </h3>
        <ol>{draft.hidden.map((item, i) => row(item, i, false))}</ol>
      </div>
      <p className="text-label text-muted-foreground">{t('customise.keyboardHint')}</p>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {error ? <MutationErrorMessage error={error} /> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
        <Button type="button" variant="ghost" onClick={onReset} className="mr-auto">
          {t('customise.reset')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('customise.cancel')}
        </Button>
        <Button type="button" onClick={onSave} loading={saving}>
          {t('customise.save')}
        </Button>
      </div>
    </section>
  );
}
