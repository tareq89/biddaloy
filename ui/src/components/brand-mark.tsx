import type { SVGProps } from 'react';

import { useTranslation } from '../i18n';

// Paths are the 50.3 brand files (landing/src/assets/brand/*.svg), inlined so
// colour follows the variant. Regenerate from those files, do not hand-edit.
const WORD_TEXT =
  'm51 203q-9 0-17-2-7-1-14-3-6-2-10-4l-3-26q8 3 19 7 10 3 22 3 13 0 18-3 5-4 5-11l0-1q0-4-2-7-2-3-8-6-5-2-15-5-13-3-22-8-9-5-13-12-5-8-5-19l0-1q0-17 12-26 12-9 34-9 14 0 24 2 10 2 17 6l2 25q-7-4-17-7-10-2-21-2-8 0-13 1-5 2-7 4-1 3-1 7l0 0q0 4 2 7 2 3 7 6 6 3 16 6 14 3 22 8 9 4 13 11 5 7 5 19l0 2q0 19-13 28-12 10-37 10zm109 0q-23 0-34-13-12-12-12-34l0-11q0-22 12-34 11-12 34-12 6 0 11 1 5 1 9 3 5 1 8 3l2 23q-5-3-11-5-6-2-13-2-12 0-18 6-5 6-5 18l0 9q0 12 5 18 6 6 18 6 8 0 14-2 6-2 11-5l-2 24q-5 2-13 4-7 3-16 3zm110-3l0-58q0-6-1-10-2-5-5-7-4-2-10-2-5 0-9 2-4 2-7 5-2 3-3 7l-6-14 7 0q1-7 5-12 3-5 10-8 6-3 16-3 11 0 18 4 7 4 10 12 4 9 4 21l0 63zm-63 0l0-132 28 0 0 30-1 31 1 2 0 69zm156 3q-24 0-36-12-12-12-12-33l0-13q0-22 12-34 12-12 36-12 23 0 35 12 12 12 12 34l0 13q0 21-12 33-12 12-35 12zm0-23q9 0 14-5 4-6 4-16l0-16q0-10-4-16-5-6-14-6-10 0-15 6-4 6-4 16l0 16q0 10 4 16 5 5 15 5zm108 23q-23 0-35-12-12-12-12-33l0-13q0-22 12-34 12-12 35-12 23 0 35 12 12 12 12 34l0 13q0 21-12 33-12 12-35 12zm0-23q9 0 14-5 5-6 5-16l0-16q0-10-5-16-5-6-14-6-9 0-14 6-5 6-5 16l0 16q0 10 5 16 5 5 14 5zm65 20l0-132 28 0 0 132z';
const WORD_ACCENT =
  'm586 200l4-128 40 0 23 79 1 0 23-79 40 0 4 128-27 0-1-44-1-52-2 0-23 81-27 0-23-81-2 0-1 52-1 44zm213 0l1-24 0-2 0-31-1-4q0-9-5-13-5-4-16-4-10 0-19 2-9 3-17 6l3-22q4-2 10-4 6-2 13-3 7-2 15-2 12 0 21 3 8 3 13 9 6 5 8 12 2 8 2 17l0 60zm-31 2q-15 0-23-7-7-7-7-21l0-3q0-14 9-21 8-7 28-9l27-4 2 17-25 4q-8 1-11 4-3 2-3 7l0 1q0 5 3 8 3 3 10 3 6 0 11-2 4-2 7-5 3-3 4-7l4 13-5 0q-1 6-5 11-3 5-10 8-6 3-16 3zm143-2l0-58q0-6-2-10-1-5-5-7-4-2-10-2-5 0-9 2-4 2-6 5-3 3-4 7l-5-14 5 0q2-7 6-12 3-5 10-8 6-3 16-3 11 0 18 4 7 4 10 12 4 9 4 21l0 63zm-64 0l0-98 28 0-1 24 1 3 0 71zm169 0l1-24-1-2 0-31 0-4q0-9-5-13-5-4-17-4-10 0-19 2-9 3-16 6l2-22q5-2 10-4 6-2 13-3 7-2 15-2 13 0 21 3 9 3 14 9 5 5 7 12 2 8 2 17l0 60zm-32 2q-15 0-22-7-8-7-8-21l0-3q0-14 9-21 9-7 28-9l27-4 2 17-25 4q-7 1-11 4-3 2-3 7l0 1q0 5 3 8 4 3 11 3 6 0 10-2 4-2 7-5 3-3 4-7l4 13-4 0q-2 6-5 11-4 5-10 8-7 3-17 3zm122-32q-23 0-35-9-11-9-11-25l0-1q0-11 4-19 5-7 15-11 10-4 26-5l52-2 0 20-27-1 0 1q7 1 11 4 4 3 7 7 2 5 2 11l0 1q0 14-11 21-11 8-33 8zm-1 47l3 0q7 0 12-1 5-1 7-3 2-2 2-5l0 0q0-4-3-5-3-2-9-3l-29-3 6 0q-3 1-6 2-2 1-4 3-1 2-1 5l0 0q0 4 2 6 3 2 7 3 5 1 13 1zm-2 21q-14 0-25-2-10-3-15-8-6-5-6-13l0-1q0-5 3-9 2-4 7-6 5-3 11-3l0-1q-8-2-12-5-4-4-4-10l0 0q0-4 2-7 2-3 6-5 4-1 10-2l0-3 22 6-7 0q-4 0-6 1-1 1-1 3l0 0q0 2 2 3 3 1 9 2l23 3q17 1 25 8 8 6 8 19l0 1q0 10-6 16-5 7-16 10-11 3-26 3zm2-88q7 0 11-1 4-2 6-5 2-4 2-9l0-1q0-4-2-8-2-3-6-5-4-1-11-1l0 0q-6 0-11 1-4 2-6 5-2 4-2 8l0 1q0 5 2 9 2 3 7 5 4 1 10 1zm112 52q-26 0-39-11-13-12-13-35l0-11q0-22 12-34 12-12 34-12 15 0 26 5 10 5 15 15 5 10 5 23l0 4q0 3-1 7 0 4-1 7l-25 0q0-5 0-10 1-5 1-10 0-6-3-11-2-4-6-6-4-3-11-3-9 0-14 6-5 5-5 15l0 9 1 3 0 7q0 4 1 8 1 4 5 6 3 3 8 5 6 1 15 1 9 0 17-2 8-2 16-5l-2 22q-7 3-16 5-9 2-20 2zm-37-42l0-18 70 0 0 18zm121-16l-7-18 7 0q2-12 9-19 7-7 20-7 2 0 4 1 2 0 4 0l1 29q-2-1-5-1-2-1-5-1-10 0-17 4-7 4-11 12zm-27 56l0-98 27 0-2 31 3 0 0 67z';
const WORD_ERP =
  'm1434 190l0-77 17 0 0 77zm5 0l0-14 48 0 0 14zm5-32l0-14 41 0 0 14zm-5-30l0-15 47 0 0 15zm103 62l-1-15q-1-4-2-6-1-3-3-4-3-1-7-1l-18 0 0-14 19 0q6 0 9-3 2-2 2-8l0-1q0-5-2-8-3-3-9-3l-19 0 0-14 21 0q14 0 20 6 7 5 7 15l0 2q0 8-4 12-4 4-12 5l0 3-4-3q7 1 11 3 3 2 5 7 2 4 3 10l2 17zm-43 0l0-77 17 0 0 42 0 7 0 28zm84-22l0-14 18 0q7 0 9-3 3-3 3-9l0-4q0-5-3-8-2-3-9-3l-19 0 0-14 21 0q14 0 21 7 6 6 6 18l0 5q0 12-6 18-7 7-21 7zm-12 22l0-77 17 0 0 45 0 7 0 25z';
const MONO =
  'm165 333q-10 0-19-2-9-1-16-3-7-3-13-5l-3-31q9 5 22 8 12 4 26 4 14 0 20-4 6-4 6-12l0-1q0-5-2-8-3-4-9-6-7-3-17-6-16-5-26-10-10-6-15-14-5-9-5-22l0-1q0-20 13-30 13-11 39-11 16 0 28 3 11 3 19 7l3 29q-9-5-20-8-11-3-24-3-9 0-15 2-5 2-8 5-2 3-2 7l0 1q0 5 3 8 2 3 9 6 6 3 18 7 15 4 25 9 10 5 15 13 5 8 5 22l0 2q0 22-14 33-14 11-43 11zm77-4l5-146 47 0 25 90 2 0 26-90 47 0 4 146-32 0-1-50-1-60-2 0-27 93-30 0-27-93-2 0-1 60-1 50z';

/** `auto` (default) follows the theme: light colours, dark colours under `[data-theme="dark"]`. */
export type BrandMarkVariant = 'auto' | 'light' | 'dark' | 'mono';

// text / accent / ERP-box colours per variant (match wordmark{,-dark,-mono}.svg).
const COLOURS: Record<Exclude<BrandMarkVariant, 'auto'>, [string, string, string]> = {
  light: ['#191919', '#4a3fd4', '#3a30b0'],
  dark: ['#f5f5f4', '#9aa0f5', '#9aa0f5'],
  mono: ['currentColor', 'currentColor', 'currentColor'],
};

// Static class strings so Tailwind sees them. `dark:` is the app's data-theme variant.
const AUTO = {
  text: 'fill-[#191919] dark:fill-[#f5f5f4]',
  accent: 'fill-[#4a3fd4] dark:fill-[#9aa0f5]',
  erp: 'fill-[#3a30b0] dark:fill-[#9aa0f5]',
  erpStroke: 'stroke-[#3a30b0] dark:stroke-[#9aa0f5]',
  tile: 'fill-[#4a3fd4] dark:fill-[#9aa0f5]',
  glyph: 'fill-white dark:fill-[#191919]',
};

interface BrandMarkProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'role' | 'aria-label'> {
  variant?: BrandMarkVariant;
  size?: 'sm' | 'md';
  /** Hide from assistive tech when the brand name is already announced next to it. */
  decorative?: boolean;
}

function useProps({ variant = 'auto', size = 'md', decorative = false, ...rest }: BrandMarkProps) {
  const { t } = useTranslation('nav');
  return {
    variant,
    size,
    svg: {
      xmlns: 'http://www.w3.org/2000/svg',
      ...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t('brand') }),
      ...rest,
    } as SVGProps<SVGSVGElement>,
  };
}

/** Fill attribute for fixed variants, class for `auto`. */
function paint(variant: BrandMarkVariant, i: 0 | 1 | 2, auto: string) {
  return variant === 'auto' ? { className: auto } : { fill: COLOURS[variant][i] };
}

export function Wordmark(props: BrandMarkProps) {
  const { variant, size, svg } = useProps(props);
  return (
    <svg viewBox="-4 0 1677 260" height={size === 'sm' ? 20 : 28} {...svg}>
      <path {...paint(variant, 0, AUTO.text)} d={WORD_TEXT} />
      <path {...paint(variant, 1, AUTO.accent)} d={WORD_ACCENT} />
      <rect
        x="1396"
        y="88"
        width="269"
        height="127"
        rx="25"
        fill="none"
        strokeWidth="8"
        {...(variant === 'auto' ? { className: AUTO.erpStroke } : { stroke: COLOURS[variant][2] })}
      />
      <path {...paint(variant, 2, AUTO.erp)} d={WORD_ERP} />
    </svg>
  );
}

export function Monogram(props: BrandMarkProps) {
  const { variant, size, svg } = useProps(props);
  const px = size === 'sm' ? 24 : 32;
  // Fixed variants: light = indigo tile + white glyph, dark = lilac tile + ink glyph,
  // mono = currentColor tile with a knocked-out glyph.
  const tile = { light: '#4a3fd4', dark: '#9aa0f5', mono: 'currentColor' };
  const glyph = { light: '#fff', dark: '#191919', mono: 'var(--color-surface, #fff)' };
  return (
    <svg viewBox="0 0 512 512" width={px} height={px} {...svg}>
      <rect
        width="512"
        height="512"
        rx="96"
        {...(variant === 'auto' ? { className: AUTO.tile } : { fill: tile[variant] })}
      />
      <path
        {...(variant === 'auto' ? { className: AUTO.glyph } : { fill: glyph[variant] })}
        d={MONO}
      />
    </svg>
  );
}
