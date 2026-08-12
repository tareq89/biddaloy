import type { ReactNode } from 'react';

/**
 * Temporary stand-in for [8.1.4]'s scaffold check — a real
 * `@biddaloy/ui` component that an SPA can import and render, proving the
 * package boundary works before any shadcn wrapper exists. Delete this file
 * and its export once [8.1.3] lands a real component to point at instead.
 */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-500 bg-surface p-8 text-text-primary">
      {children}
    </div>
  );
}
