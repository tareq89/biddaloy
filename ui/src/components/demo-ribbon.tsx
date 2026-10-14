/* eslint-disable logical-properties/no-physical-direction-classes -- pinned to the physical top-right corner in every locale (D19) */
/**
 * Red 45° corner triangle reading "DEMO" — [58.2.06]. Marks the demo school.
 *
 * Positioned `absolute right-0 top-0`, so the app renders it ONCE inside the shell root, which
 * must be `relative`. `pointer-events-none` keeps the corner clickable; `print:hidden` keeps it
 * off printed pages. `label` is the accessible name (i18n lives in the client); the visible text
 * is "DEMO" in every locale. Pair with `reserveCorner` on `AppHeader` / `AuthLayout` so nothing
 * sits under it.
 */
export interface DemoRibbonProps {
  /** Accessible name, already translated by the app. */
  label: string;
}

export function DemoRibbon({ label }: DemoRibbonProps) {
  return (
    <div
      role="note"
      aria-label={label}
      className="pointer-events-none absolute top-0 right-0 z-40 size-16 overflow-hidden md:size-24 print:hidden"
    >
      <div
        className="absolute inset-0 bg-destructive"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
      />
      <span
        aria-hidden="true"
        className="absolute top-[36%] left-[64%] -translate-x-1/2 -translate-y-1/2 rotate-45 text-caption font-bold tracking-widest whitespace-nowrap text-primary-foreground md:text-label"
      >
        DEMO
      </span>
    </div>
  );
}
