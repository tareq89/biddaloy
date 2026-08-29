/**
 * WAI-ARIA "skip link" pattern: visually hidden until it receives
 * keyboard focus, so a mouse/touch visitor never sees it but a keyboard
 * visitor's very first Tab stop lets them jump straight past the sidebar
 * nav to the route's own content, instead of tabbing through every nav
 * link on every single page. `focus-visible:` (not `focus:`) so it only
 * reveals for keyboard focus, matching what "skip to content" is for —
 * a mouse click on it would never happen in practice.
 */
import type { ReactNode } from 'react';

export interface SkipLinkProps {
  /** `id` of the landmark to jump to, without the leading `#` — e.g.
   * `main-content`. That element needs `tabIndex={-1}` of its own for
   * the browser to actually focus it on jump, not just scroll to it. */
  targetId: string;
  children: ReactNode;
}

export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-2 focus-visible:top-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-e3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </a>
  );
}
