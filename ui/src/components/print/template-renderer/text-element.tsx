import { OverflowPolicy, type PrintElement } from '@biddaloy/shared';
import * as React from 'react';

import { fitFontSize } from './fit-text';

type TextEl = Extract<PrintElement, { type: 'TEXT' }>;

/** Stepped shrink floor when the template sets no `minSizePt`. */
const DEFAULT_MIN_PT = 6;

export interface TextElementProps {
  el: TextEl;
  text: string;
  /** Show the red overflow outline (editor and preview only, never print). */
  showOverflow: boolean;
  onOverflow?: ((elementId: string, overflowed: boolean) => void) | undefined;
}

/** Fills the positioned wrapper the renderer gives it. Sizes are pt, boxes are mm. */
export function TextElement({ el, text, showOverflow, onOverflow }: TextElementProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = React.useState(false);
  // Webfonts change text metrics once loaded, so re-measure then.
  const [fontsTick, setFontsTick] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  const shrink = el.overflow === OverflowPolicy.SHRINK;
  const wrap = el.overflow === OverflowPolicy.WRAP;

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fits = (pt: number) => {
      node.style.fontSize = `${pt}pt`;
      return node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight;
    };
    const { overflowed: over } = shrink
      ? fitFontSize(el.sizePt, Math.min(el.sizePt, el.minSizePt ?? DEFAULT_MIN_PT), fits)
      : { overflowed: !fits(el.sizePt) };
    setOverflowed(over);
    onOverflow?.(el.id, over);
  }, [
    el.id,
    el.sizePt,
    el.minSizePt,
    el.fontFamily,
    el.w,
    el.h,
    text,
    shrink,
    fontsTick,
    onOverflow,
  ]);

  return (
    <div
      ref={ref}
      data-overflow={overflowed && showOverflow ? 'true' : undefined}
      style={{
        width: '100%',
        height: '100%',
        fontFamily: `"${el.fontFamily}", sans-serif`,
        fontSize: `${el.sizePt}pt`,
        fontWeight: el.weight,
        color: el.color,
        textAlign: el.align,
        lineHeight: 1.2,
        whiteSpace: wrap ? 'normal' : 'nowrap',
        overflow: el.overflow === OverflowPolicy.CLIP ? 'hidden' : 'visible',
        overflowWrap: wrap ? 'anywhere' : 'normal',
        outline: showOverflow && overflowed ? '0.3mm dashed var(--color-destructive)' : undefined,
      }}
    >
      {text}
    </div>
  );
}
