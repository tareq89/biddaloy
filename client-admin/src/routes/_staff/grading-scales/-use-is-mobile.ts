/**
 * True below the app's 768px card-mode breakpoint, so a page can mount ONE
 * of two layouts (phone cards vs desktop table) instead of both.
 * ponytail: a copy of the hook in `marks/$examId.$sectionId.$subjectId.tsx`;
 * a shared `useIsMobile` in `@biddaloy/ui/hooks` would replace both.
 */
import * as React from 'react';

const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia(QUERY).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(QUERY);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
