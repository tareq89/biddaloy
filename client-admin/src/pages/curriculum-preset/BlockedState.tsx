/** [35.4.3] Why a preset can't be applied: what already exists, one link row per kind. */
import { Card } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarRange,
  ChevronRight,
  Database,
  FilePenLine,
  FileStack,
  GraduationCap,
  Ruler,
  School,
  type LucideIcon,
} from 'lucide-react';

interface BlockerKind {
  key: string;
  to?:
    | '/academic-years'
    | '/classes'
    | '/students'
    | '/exams'
    | '/grading-scales'
    | '/exams/templates';
  icon: LucideIcon;
}

/** Server blocker labels (`FRESH_TENANT_ENTITIES`) -> Bangla-translatable key, list page and icon.
 * A label with no list route (subjects) renders without a link; an unknown label is "other". */
const BLOCKERS: Record<string, BlockerKind> = {
  'academic years': { key: 'academicYears', to: '/academic-years', icon: CalendarRange },
  classes: { key: 'classes', to: '/classes', icon: School },
  subjects: { key: 'subjects', icon: BookOpen },
  students: { key: 'students', to: '/students', icon: GraduationCap },
  exams: { key: 'exams', to: '/exams', icon: FilePenLine },
  'grading scales': { key: 'gradingScales', to: '/grading-scales', icon: Ruler },
  'exam templates': { key: 'examTemplates', to: '/exams/templates', icon: FileStack },
};
const OTHER: BlockerKind = { key: 'other', icon: Database };

export interface BlockedStateProps {
  blockers: { entity: string; count: number }[];
}

export function BlockedState({ blockers }: BlockedStateProps) {
  const { t } = useTranslation('curriculumPreset');
  const config = useRegionConfig();
  return (
    <Card className="overflow-hidden" data-testid="preset-blocked">
      <div className="px-4 pt-4 pb-2 md:px-5 md:pt-5">
        <h2 className="text-h2">{t('blocked.heading')}</h2>
      </div>
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {blockers.map(({ entity, count }) => {
          const { key, to, icon: Icon } = BLOCKERS[entity] ?? OTHER;
          const name = t(`blocked.entities.${key}`);
          const countText = t(key === 'students' ? 'blocked.countPeople' : 'blocked.countItems', {
            count: formatNumber(count, config),
          });
          const inner = (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
              <span className="text-text-secondary tabular-nums">{countText}</span>
              {to ? (
                <ChevronRight aria-hidden className="size-4 text-text-secondary" />
              ) : (
                <span className="size-4" />
              )}
            </>
          );
          const rowClass = 'flex min-h-12 items-center gap-3 px-4 py-1.5 md:px-5';
          return (
            <li key={entity}>
              {to ? (
                // The link's name is its visible text (kind + count): no aria-label to drift from it.
                <Link to={to} className={`${rowClass} hover:bg-muted`}>
                  {inner}
                </Link>
              ) : (
                <div className={rowClass}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
