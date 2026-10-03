/** [35.4.3] Why a preset can't be applied: what already exists, each with a link to its list. */
import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';

/** Server blocker labels (`FRESH_TENANT_ENTITIES`) -> list page. A label with
 * no list route in this app (subjects, exam templates) renders without a link. */
const ENTITY_ROUTES = {
  'academic years': '/academic-years',
  classes: '/classes',
  students: '/students',
  exams: '/exams',
  'grading scales': '/grading-scales',
} as const;

export interface BlockedStateProps {
  blockers: { entity: string; count: number }[];
}

export function BlockedState({ blockers }: BlockedStateProps) {
  const { t } = useTranslation('curriculumPreset');
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="preset-blocked">
      <h2 className="text-sm font-medium">{t('blocked.heading')}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {blockers.map(({ entity, count }) => {
          const to = ENTITY_ROUTES[entity as keyof typeof ENTITY_ROUTES];
          return (
            <li key={entity}>
              <span>{t('blocked.item', { entity, count })}</span>
              {to && (
                <>
                  {' · '}
                  <Link to={to} className="text-primary underline underline-offset-2">
                    {t('blocked.open', { entity })}
                  </Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
