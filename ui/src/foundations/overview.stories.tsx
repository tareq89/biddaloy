/**
 * Foundations overview — the reversible-by-accident decisions from design
 * contract `docs/architecture/09-design-direction.md`, stated as rules, with
 * links to the sibling Foundations pages that render each one live and to
 * the document itself as the source of truth.
 *
 * Deliberately rules-plus-links, not a restatement of the document: the
 * document has the numbers, the tables and the "why"; duplicating that here
 * would just be a second place for it to drift out of sync. This page picks
 * a plain canvas story over Storybook's docs-mode (`.mdx`) — no `.mdx` file
 * exists anywhere in this repo today and `.storybook/main.ts`'s `stories`
 * glob does not include one, so adding the first would mean extending that
 * config for a single page; every other Foundations story is already a
 * `.tsx` canvas story, so this one follows that same convention instead.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

const meta: Meta = {
  title: 'Foundations/Overview',
};

export default meta;
type Story = StoryObj;

function Rule({
  title,
  children,
  seeAlso,
}: {
  title: string;
  children: ReactNode;
  seeAlso: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-card p-4">
      <p className="text-h3">{title}</p>
      <div className="text-body text-muted-foreground">{children}</div>
      <p className="text-caption text-muted-foreground">See {seeAlso}.</p>
    </div>
  );
}

function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted-foreground">
        Four decisions this design layer makes reversible only if you know the rule. The full
        tables, numbers and &quot;why&quot; live in{' '}
        <code>docs/architecture/09-design-direction.md</code> — this page is a lookup, not a copy of
        it.
      </p>

      <Rule title="Subtle vs. functional border (§4)" seeAlso={<code>Foundations/Borders</code>}>
        Would a user who cannot see this line lose information? Yes →{' '}
        <code>border-border-functional</code> (must clear 3:1). No →{' '}
        <code>border-border-subtle</code> (exempt from WCAG SC 1.4.11) — card outlines, dividers,
        table rules.
      </Rule>

      <Rule
        title="Which elevation step a new surface takes (§5)"
        seeAlso={<code>Foundations/Elevation</code>}
      >
        Pick by what the surface <em>is</em>, not by how heavy it should look:{' '}
        <code>shadow-e1</code> for cards, resting panels and tabs; <code>shadow-e2</code> for
        dropdown, select and popover; <code>shadow-e3</code> for dialog, drawer, toast and the
        skip-link. In dark mode every elevated surface also carries{' '}
        <code>border border-border-subtle</code> — a shadow alone does not read on{' '}
        <code>#0f172a</code>.
      </Rule>

      <Rule title="Comfortable vs. compact density (§6)" seeAlso={<code>Foundations/Density</code>}>
        Staff routes (<code>AdminShell</code>) are compact by the ABSENCE of the{' '}
        <code>data-density</code> attribute — no attribute, no <code>--control-h</code>, every
        control keeps its historical height. <code>/portal</code> and the auth screens set{' '}
        <code>data-density=&quot;comfortable&quot;</code> on <code>document.documentElement</code>,
        which lifts every control to the 44px WCAG 2.2 SC 2.5.5 target in one declaration. No
        component takes a density prop.
      </Rule>

      <Rule
        title="Tokens only — no raw hex, no Tailwind default hue scales"
        seeAlso={
          <>
            <code>ui/scripts/check-contrast.mjs</code> and{' '}
            <code>ui/scripts/check-raw-palette.mjs</code>
          </>
        }
      >
        A component reaches for a role token (<code>bg-muted</code>, <code>text-destructive</code>,{' '}
        <code>text-status-paid-fg</code>) before a raw scale entry (<code>bg-neutral-100</code>),
        and never a literal hex or one of Tailwind&apos;s own default hue scales — this page&apos;s
        own source cannot spell one out as a live example, on purpose: it would trip{' '}
        <code>check-raw-palette.mjs</code> the same way a real component&apos;s would. Both gates
        run in CI; <code>Foundations/Colors</code> is the live proof that every token they check
        actually clears its WCAG minimum.
      </Rule>
    </div>
  );
}

export const Overview: Story = {
  render: () => <OverviewPage />,
};
