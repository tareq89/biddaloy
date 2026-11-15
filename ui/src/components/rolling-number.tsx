/**
 * [3329.1.05] Digits slide up into place 100 ms apart. Takes the
 * already-formatted string (`formatNumber`), so Bangla digits and grouping
 * commas arrive as the caller made them; only digits (Latin 0-9 or Bangla
 * ০-৯) animate, everything else renders static.
 *
 * The real text is one sr-only span (screen readers and `getByText` see
 * exactly `value`). The visible glyphs are aria-hidden spans that paint their
 * character from `data-char` via `::after`, so no second copy of the text
 * exists in the DOM to double-match a query.
 *
 * Reduced motion is read in JS, not left to the global CSS rule: that rule
 * zeroes durations but not `transition-delay`, so the 100 ms stagger would
 * still make digits pop in one after another. Use for KPI tiles and totals
 * only, never table cells.
 */
import * as React from 'react';

const STAGGER_MS = 100;
const DIGIT = /[0-9০-৯]/;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Digit({ char, index }: { char: string; index: number }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    // One frame after mount so the browser paints the hidden state first.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <span
      data-rolling-digit=""
      data-char={char}
      className="inline-block transition-[opacity,translate] duration-(--motion-duration-expand) ease-(--motion-ease-standard) after:content-[attr(data-char)]"
      style={{
        opacity: shown ? 1 : 0,
        translate: shown ? '0 0' : '0 0.5em',
        transitionDelay: `${index * STAGGER_MS}ms`,
      }}
    />
  );
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const [reduced] = React.useState(prefersReducedMotion);
  if (reduced) return <span className={className}>{value}</span>;

  // Stagger counts digits only, so "১,২৩৪" does not wait on the comma.
  let digitIndex = 0;
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">
        {Array.from(value).map((char, i) =>
          DIGIT.test(char) ? (
            <Digit key={`${i}-${char}`} char={char} index={digitIndex++} />
          ) : (
            <span
              key={`${i}-${char}`}
              data-char={char}
              className="after:content-[attr(data-char)]"
            />
          ),
        )}
      </span>
    </span>
  );
}
