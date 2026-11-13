import { Button, RouteStatusState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PowerOffIcon } from 'lucide-react';

/**
 * Whole-page refusal for a route whose module is off (Epic 77 D32). The
 * server refuses the same URL with 403; this is the page behind a bookmark.
 * ADMIN gets a way to fix it, everyone else is told who can.
 */
export function ModuleOffState({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('common');
  return (
    <RouteStatusState
      title={t('moduleOff.title')}
      explanation={isAdmin ? '' : t('moduleOff.askAdmin')}
      icon={<PowerOffIcon aria-hidden="true" />}
    >
      {isAdmin && (
        <Button asChild>
          {/* Plain href: the `modules` settings section arrives with the wave-4 screen,
              so a typed router Link to it cannot compile yet. */}
          <a href="/settings?section=modules">{t('moduleOff.turnOn')}</a>
        </Button>
      )}
    </RouteStatusState>
  );
}
