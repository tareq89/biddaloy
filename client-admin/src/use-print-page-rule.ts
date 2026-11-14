import { useEffect } from 'react';

/**
 * Adds an `@page` rule only while the calling screen is mounted (#1374).
 * `@page` cannot be scoped by selector, and a CSS file imported by a route stays loaded
 * after leaving it, so a static `@page` leaked into every later printout of the session.
 */
export function usePrintPageRule(rule: string): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@page { ${rule} }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [rule]);
}
