import { Button, RouteStatusState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { PowerOffIcon } from 'lucide-react';

/**
 * Whole-page refusal for a route whose module is off (Epic 77 D32). The
 * server refuses the same URL with 403; this is the page behind a bookmark.
 * ADMIN gets a way to fix it, everyone else is told who can. The family portal
 * (`portal`) never has an admin, so it says "ask your school".
 */
export function ModuleOffState({
  isAdmin,
  portal = false,
}: {
  isAdmin: boolean;
  portal?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <RouteStatusState
      title={t('moduleOff.title')}
      explanation={isAdmin ? '' : t(portal ? 'moduleOff.askSchool' : 'moduleOff.askAdmin')}
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
