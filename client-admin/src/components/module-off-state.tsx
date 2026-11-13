import { Button, RouteStatusState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
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
          <Link to="/settings" search={{ section: 'modulesWords' }}>
            {t('moduleOff.turnOn')}
          </Link>
        </Button>
      )}
    </RouteStatusState>
  );
}
