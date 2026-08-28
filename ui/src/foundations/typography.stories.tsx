/**
 * Foundations page for the two-script type system (design contract §2). There
 * is no `Typography` component — the ramp ships as Tailwind utilities
 * (`text-display` … `text-caption`), each carrying size, line-height, weight
 * and tracking together — so these stories render the utilities directly.
 *
 * Every specimen is mixed-script on purpose. A Latin-only ramp preview would
 * hide the one thing this system exists to get right: Bangla and English
 * sitting on the same line at the same apparent weight.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { typography } from '../../tailwind.preset';

const meta: Meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const STEPS = [
  { step: 'display', use: 'Portal page title', className: 'text-display' },
  { step: 'h1', use: 'Admin page titles', className: 'text-h1' },
  { step: 'h2', use: 'Section headings', className: 'text-h2' },
  { step: 'h3', use: 'Card headings', className: 'text-h3' },
  { step: 'body-lg', use: 'Portal default body', className: 'text-body-lg' },
  { step: 'body', use: 'Admin default body', className: 'text-body' },
  { step: 'label', use: 'Form labels, table headers', className: 'text-label' },
  { step: 'caption', use: 'Help text, timestamps', className: 'text-caption' },
] as const;

/** The whole ramp, every step on one mixed-script line. */
export const Ramp: Story = {
  render: () => (
    <div className="flex flex-col gap-6 text-foreground">
      {STEPS.map(({ step, use, className }) => {
        const spec = typography.ramp[step];
        return (
          <div key={step} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2 text-caption text-muted-foreground">
              <code>text-{step}</code>
              <span>
                {spec.size} / {spec.lineHeight} · {spec.weight} · {spec.tracking}
              </span>
              <span>— {use}</span>
            </div>
            <p className={className}>Rahim Uddin — ফি পরিশোধ ৳ ১,২৩৪</p>
          </div>
        );
      })}
    </div>
  ),
};

/**
 * Conjuncts are produced by GSUB, so they are the check that
 * `--layout-features='*'` survived subsetting: if the Bangla subset had been
 * pruned to default features these would render as separate letters with
 * visible hasant marks, or as dotted-circle placeholders.
 */
export const ConjunctShaping: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-foreground">
      <p className="text-caption text-muted-foreground">
        Conjuncts must render as single ligated forms, not letter + hasant + letter.
      </p>
      <p className="text-display">ক্ষ জ্ঞ ন্ত স্ত্র দ্ধ ঙ্গ</p>
      <p className="text-body-lg">শিক্ষার্থীর নাম ও শ্রেণি — বিজ্ঞান বিভাগ</p>
    </div>
  ),
};

const ROWS = [
  { label: 'জানুয়ারি টিউশন', bn: '৳ ১,২০০.০০', en: '1,200.00' },
  { label: 'পরীক্ষার ফি', bn: '৳ ৮৫০.৫০', en: '850.50' },
  { label: 'পরিবহন', bn: '৳ ১১,০০০.০০', en: '11,000.00' },
  { label: 'বিলম্ব ফি', bn: '৳ ৯৯.৯৯', en: '99.99' },
];

/**
 * Why §2 requires `tabular-nums` on money columns — and where it stops working.
 *
 * The Latin block below is the real demonstration: left column is the default
 * proportional figures, right column is `tabular-nums`, and only the right one
 * aligns on the decimal.
 *
 * The Bangla block is rendered once, not as a before/after pair, because there
 * would be no difference to show. The shipped `anek-bangla.woff2` subset has no
 * `tnum` GSUB feature and its Bengali digits are proportional, so
 * `font-variant-numeric: tabular-nums` is a no-op on Bengali numerals — which
 * is the app's default locale (`bn`). The class is still applied everywhere in
 * the app: it is correct and effective under `en` (`REGION_BD_EN`) and harmless
 * under `bn`. See `docs/architecture/09-design-direction.md` §2.
 */
export const TabularNumbers: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-8 text-body text-foreground">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-8 gap-y-2">
        <span className="text-label text-muted-foreground">Latin digits (en)</span>
        <span className="text-end text-label text-muted-foreground">proportional</span>
        <span className="text-end text-label text-muted-foreground">tabular-nums</span>
        {ROWS.map((row) => (
          <div key={`${row.label}-en`} className="contents">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-end">{row.en}</span>
            <span className="text-end tabular-nums">{row.en}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2">
        <span className="text-label text-muted-foreground">
          Bengali digits (bn) — tabular-nums has no effect
        </span>
        <span className="text-end text-label text-muted-foreground">tabular-nums</span>
        {ROWS.map((row) => (
          <div key={row.label} className="contents">
            <span>{row.label}</span>
            <span className="text-end tabular-nums">{row.bn}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};

/**
 * The failure this system is built to avoid: two unrelated families on one
 * line. The top row is the shipped single-family stack; the bottom forces a
 * generic Bangla fallback next to a Latin one, so the apparent weights and
 * x-heights disagree mid-sentence.
 */
export const OneApparentWeight: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-foreground">
      <div>
        <p className="text-caption text-muted-foreground">Biddaloy Sans (shipped)</p>
        <p className="text-h2">Fatima Rahman — বকেয়া ৳ ৩,৫০০</p>
      </div>
      <div>
        <p className="text-caption text-muted-foreground">Unmatched pairing (for contrast only)</p>
        <p className="text-h2" style={{ fontFamily: 'serif' }}>
          Fatima Rahman — বকেয়া ৳ ৩,৫০০
        </p>
      </div>
    </div>
  ),
};
