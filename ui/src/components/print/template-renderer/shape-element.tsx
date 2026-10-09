import { ShapeKind, type PrintElement } from '@biddaloy/shared';

type ShapeEl = Extract<PrintElement, { type: 'SHAPE' }>;

export function ShapeElement({ el }: { el: ShapeEl }) {
  if (el.shape === ShapeKind.LINE) {
    // A line runs along the longer axis of its box, centred on the shorter one.
    const horizontal = el.w >= el.h;
    return (
      <div
        style={{
          position: 'absolute',
          background: el.stroke ?? 'currentColor',
          ...(horizontal
            ? { left: 0, width: '100%', height: `${el.strokeWidthMm}mm`, top: '50%' }
            : { top: 0, height: '100%', width: `${el.strokeWidthMm}mm`, left: '50%' }),
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: el.fill,
        border: el.stroke ? `${el.strokeWidthMm}mm solid ${el.stroke}` : undefined,
        borderRadius: `${el.radiusMm}mm`,
      }}
    />
  );
}
