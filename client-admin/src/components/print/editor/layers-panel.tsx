/**
 * [32.3.1] The layer list (D31): every element on this side, selectable with the
 * arrow keys and Enter, plus add / delete / reorder. It is the keyboard path to the
 * canvas — everything you can do to an element with the mouse can be done from here
 * and the properties form.
 */
import type { PrintElement } from '@biddaloy/shared';
import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import type { NewElementType } from './editor-state';
import { useElementLabel } from './element-label';

export interface LayersPanelProps {
  elements: PrintElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (type: NewElementType) => void;
  onRemove: (id: string) => void;
  /** -1 = one step towards the back of the list, +1 = towards the front. */
  onMove: (id: string, delta: -1 | 1) => void;
  /** Extra info shown after a layer's name (e.g. how sharp an image will print). */
  badgeOf?: (el: PrintElement) => React.ReactNode;
}

const ADD: Array<{ type: NewElementType; key: string }> = [
  { type: 'TEXT', key: 'addText' },
  { type: 'IMAGE', key: 'addImage' },
  { type: 'QR', key: 'addQr' },
  { type: 'SHAPE', key: 'addShape' },
];

export function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  badgeOf,
}: LayersPanelProps) {
  const { t } = useTranslation('printEditor');
  const labelOf = useElementLabel();
  const listRef = React.useRef<HTMLUListElement>(null);
  const index = elements.findIndex((el) => el.id === selectedId);

  /** Arrow keys move focus (and the selection) between layers; Enter/Space select via the button itself. */
  function onKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    // Shift+arrow is a 5 mm nudge (handled by the editor), not list navigation.
    if (event.shiftKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-layer]') ?? [],
    );
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (buttons.length === 0) return;
    event.preventDefault();
    const next =
      buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
    if (next?.dataset.layer) onSelect(next.dataset.layer);
  }

  return (
    <section aria-label={t('layers.title')} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{t('layers.title')}</h2>

      <div role="group" aria-label={t('layers.addGroup')} className="flex flex-wrap gap-1">
        {ADD.map(({ type, key }) => (
          <Button key={type} type="button" size="sm" variant="outline" onClick={() => onAdd(type)}>
            {t(`layers.${key}`)}
          </Button>
        ))}
      </div>

      {elements.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('layers.empty')}
        </p>
      ) : (
        // Arrow-key handling on the list itself; the layers inside are real buttons.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <ul ref={listRef} data-layers-list onKeyDown={onKeyDown} className="flex flex-col gap-1">
          {/* Front-most first, like every design tool. */}
          {[...elements].reverse().map((el) => (
            <li key={el.id}>
              <button
                type="button"
                data-layer={el.id}
                aria-pressed={el.id === selectedId}
                onClick={() => onSelect(el.id)}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-start text-sm ${
                  el.id === selectedId ? 'border-primary bg-primary/10' : 'border-border-subtle'
                }`}
              >
                <span className="text-xs text-muted-foreground">{t(`layers.type.${el.type}`)}</span>
                <span className="truncate">{labelOf(el)}</span>
                {badgeOf?.(el)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId && index >= 0 ? (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={index === elements.length - 1}
            onClick={() => onMove(selectedId, 1)}
          >
            {t('layers.moveUp')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={index === 0}
            onClick={() => onMove(selectedId, -1)}
          >
            {t('layers.moveDown')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => onRemove(selectedId)}
          >
            {t('layers.delete')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
