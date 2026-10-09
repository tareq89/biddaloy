/**
 * [32.3.1] The design surface (D3, D31): the real `TemplateRenderer` in editor mode
 * at the chosen zoom, mm rulers on the top and left, and a dashed 3 mm safe-zone
 * guide.
 *
 * Mouse and touch use POINTER EVENTS only (no drag-and-drop library): pressing an
 * element selects it and starts a drag; the eight handles around the selected
 * element resize it. Pixels become millimetres through the zoom we set ourselves,
 * not by measuring the DOM. A drag is held HERE until release and then committed
 * once, so a whole drag is one undo step, not hundreds.
 *
 * Every element also has a real, focusable button over it, so the canvas is not
 * mouse-only; the keyboard route to the same actions is the layers list and the
 * properties form.
 */
import type { PrintElement, TemplateDefinition } from '@biddaloy/shared';
import { TemplateRenderer, type PrintFont } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { clampRect, elementsOf, type EditorSide, type Rect } from './editor-state';
import { useElementLabel } from './element-label';

/** CSS pixels in one millimetre at 100% (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
export const SAFE_ZONE_MM = 3;
const RULER_PX = 20;

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Drag {
  id: string;
  mode: 'move' | Handle;
  startX: number;
  startY: number;
  origin: Rect;
  rect: Rect;
}

export interface EditorCanvasProps {
  definition: TemplateDefinition;
  side: EditorSide;
  /** Percent: 100–400. */
  zoom: number;
  selectedId: string | null;
  /** Sample text for data fields (image fields stay blank). */
  values: Record<string, string>;
  assetUrl: (assetId: string) => string;
  fonts: PrintFont[];
  onSelect: (id: string | null) => void;
  /** Called once when a drag or resize is released. */
  onCommitRect: (id: string, rect: Rect) => void;
}

/** The rectangle after dragging by (dx, dy) mm; `mode` says which edges move. */
export function applyDrag(origin: Rect, mode: Drag['mode'], dx: number, dy: number): Rect {
  if (mode === 'move') return { ...origin, x: origin.x + dx, y: origin.y + dy };
  const next = { ...origin };
  if (mode.includes('e')) next.w = origin.w + dx;
  if (mode.includes('s')) next.h = origin.h + dy;
  if (mode.includes('w')) {
    next.x = origin.x + dx;
    next.w = origin.w - dx;
  }
  if (mode.includes('n')) {
    next.y = origin.y + dy;
    next.h = origin.h - dy;
  }
  return next;
}

function withRect(
  draft: TemplateDefinition,
  side: EditorSide,
  id: string,
  rect: Rect,
): TemplateDefinition {
  const swap = (els: PrintElement[]) => els.map((el) => (el.id === id ? { ...el, ...rect } : el));
  return side === 'back' && draft.back
    ? { ...draft, back: { ...draft.back, elements: swap(draft.back.elements) } }
    : { ...draft, front: { ...draft.front, elements: swap(draft.front.elements) } };
}

const handleStyle = (h: Handle): React.CSSProperties => {
  const x = h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%';
  const y = h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%';
  const cursor = {
    n: 'ns',
    s: 'ns',
    e: 'ew',
    w: 'ew',
    ne: 'nesw',
    sw: 'nesw',
    nw: 'nwse',
    se: 'nwse',
  }[h];
  return { left: x, top: y, cursor: `${cursor}-resize` };
};

export function EditorCanvas({
  definition,
  side,
  zoom,
  selectedId,
  values,
  assetUrl,
  fonts,
  onSelect,
  onCommitRect,
}: EditorCanvasProps) {
  const { t } = useTranslation('printEditor');
  const labelOf = useElementLabel();
  const [drag, setDrag] = React.useState<Drag | null>(null);

  const scale = (zoom / 100) * PX_PER_MM; // px per mm
  const { widthMm, heightMm } = definition.page;
  const shown = drag ? withRect(definition, side, drag.id, drag.rect) : definition;
  const shownElements = elementsOf(shown, side);

  function begin(event: React.PointerEvent, el: PrintElement, mode: Drag['mode']) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect(el.id);
    const origin = { x: el.x, y: el.y, w: el.w, h: el.h };
    setDrag({
      id: el.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      rect: origin,
    });
  }

  function move(event: React.PointerEvent) {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    setDrag({
      ...drag,
      rect: clampRect(applyDrag(drag.origin, drag.mode, dx, dy), definition.page),
    });
  }

  function end(event: React.PointerEvent) {
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const { id, rect, origin } = drag;
    setDrag(null);
    const moved =
      rect.x !== origin.x || rect.y !== origin.y || rect.w !== origin.w || rect.h !== origin.h;
    if (moved) onCommitRect(id, rect); // one history step for the whole gesture
  }

  const ticksX = Array.from({ length: Math.floor(widthMm / 10) + 1 }, (_, i) => i * 10);
  const ticksY = Array.from({ length: Math.floor(heightMm / 10) + 1 }, (_, i) => i * 10);

  return (
    <div className="overflow-auto rounded-lg border border-border-subtle bg-muted/40 p-4">
      <div
        role="group"
        aria-label={t('canvas.label')}
        className="relative"
        style={{ width: widthMm * scale + RULER_PX, height: heightMm * scale + RULER_PX }}
      >
        {/* Rulers (decorative: the numbers are in the properties form). */}
        <div
          aria-hidden="true"
          className="absolute top-0 text-[10px] text-muted-foreground"
          style={{ left: RULER_PX, width: widthMm * scale, height: RULER_PX }}
        >
          {ticksX.map((mm) => (
            <span
              key={mm}
              className="absolute border-s border-border-subtle ps-0.5"
              style={{ left: mm * scale, height: RULER_PX }}
            >
              {mm}
            </span>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="absolute left-0 text-[10px] text-muted-foreground"
          style={{ top: RULER_PX, width: RULER_PX, height: heightMm * scale }}
        >
          {ticksY.map((mm) => (
            <span
              key={mm}
              className="absolute border-t border-border-subtle"
              style={{ top: mm * scale }}
            >
              {mm}
            </span>
          ))}
        </div>

        <div
          className="absolute"
          style={{
            left: RULER_PX,
            top: RULER_PX,
            width: widthMm * scale,
            height: heightMm * scale,
          }}
        >
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left',
              width: 'max-content',
            }}
          >
            <TemplateRenderer
              definition={shown}
              side={side}
              values={values}
              assetUrl={assetUrl}
              fonts={fonts}
              mode="editor"
              {...(selectedId ? { selectedId } : {})}
            />
          </div>

          {/* Safe zone: keep important things this far from the edge. */}
          <div
            aria-hidden="true"
            title={t('canvas.safeZone')}
            className="pointer-events-none absolute border border-dashed border-primary/60"
            style={{ inset: SAFE_ZONE_MM * scale }}
          />

          {/* Hit boxes: real buttons, so the canvas is reachable by Tab as well as by pointer. */}
          {shownElements.map((el) => {
            const selected = el.id === selectedId;
            return (
              <button
                key={el.id}
                type="button"
                aria-label={t('canvas.element', {
                  type: t(`layers.type.${el.type}`),
                  label: labelOf(el),
                })}
                aria-pressed={selected}
                onClick={() => onSelect(el.id)}
                onPointerDown={(e) => begin(e, el, 'move')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className={`absolute cursor-move bg-transparent ${selected ? 'outline outline-2 outline-primary' : 'hover:outline hover:outline-1 hover:outline-primary/50'}`}
                style={{
                  left: el.x * scale,
                  top: el.y * scale,
                  width: el.w * scale,
                  height: el.h * scale,
                  touchAction: 'none',
                }}
              >
                {selected
                  ? HANDLES.map((h) => (
                      <span
                        key={h}
                        aria-hidden="true"
                        data-handle={h}
                        onPointerDown={(e) => begin(e, el, h)}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-primary bg-card"
                        style={handleStyle(h)}
                      />
                    ))
                  : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
