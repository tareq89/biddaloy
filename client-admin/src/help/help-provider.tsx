/**
 * [44.2.01] Feeds the generated help index to ui's `HelpProvider` (E14/E15).
 * The current page id is the guide page of the deepest matched route, looked
 * up in `HELP_ROUTES`, so no route file declares it. Wraps the whole shell
 * (not just the `<Outlet />`) because the top-bar launcher reads it for F1.
 */
import { HelpProvider } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useRouterState } from '@tanstack/react-router';
import type * as React from 'react';

import { HELP_INDEX, HELP_ROUTES } from './help-index.gen';

/** TanStack writes index routes as `/students/`; `HELP_ROUTES` keys have no trailing slash. */
export function helpPageIdFor(fullPath: string | undefined): string | null {
  if (!fullPath) return null;
  const path = fullPath !== '/' && fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
  return (HELP_ROUTES as Record<string, string>)[path] ?? null;
}

export function AppHelpProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation('common');
  const fullPath = useRouterState({
    select: (s) => s.matches[s.matches.length - 1]?.fullPath,
  });
  return (
    <HelpProvider
      index={HELP_INDEX}
      lang={i18n.language.startsWith('bn') ? 'bn' : 'en'}
      baseUrl={import.meta.env.VITE_HANDBOOK_URL ?? ''}
      pageId={helpPageIdFor(fullPath)}
    >
      {children}
    </HelpProvider>
  );
}
