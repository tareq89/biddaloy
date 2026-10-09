import { Permission } from '@biddaloy/shared';
import {
  programsQueryOptions,
  useClasses,
  useHasPermission,
  type Class,
  type RecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { audienceSummary } from './-schedule-summary';

/** Who a rule bills, in words ("Class 7 · A · Hifz"). Its own component, with its own lookups:
 * `DataTable` caches a cell's value per row, so names that arrive after the first render (classes,
 * programs) would never show in a plain string. React Query dedupes the requests across rows. */
export function AudienceCell({ schedule }: { schedule: RecurringSchedule }) {
  const { t } = useTranslation('fees');
  // Resolves audience.class_id/section_id to real names — `Class.sections` is already embedded,
  // so this needs no per-class follow-up request.
  const classesQuery = useClasses({});
  const { classesById, sectionsById } = React.useMemo(() => {
    const classes = new Map<string, string>();
    const sections = new Map<string, string>();
    for (const klass of classesQuery.data?.data ?? []) {
      classes.set(klass.id, klass.name);
      for (const section of (klass as Class).sections ?? []) {
        sections.set(section.id, section.section_name);
      }
    }
    return { classesById: classes, sectionsById: sections };
  }, [classesQuery.data]);
  // A role without `PROGRAM_READ` cannot call `GET /programs` — no request, no red toast (B10).
  const canReadPrograms = useHasPermission(Permission.PROGRAM_READ);
  const programsQuery = useQuery({
    ...programsQueryOptions({ includeArchived: true }),
    enabled: canReadPrograms,
  });
  const programsById = React.useMemo(
    () => new Map((programsQuery.data ?? []).map((program) => [program.id, program.name])),
    [programsQuery.data],
  );
  return <>{audienceSummary(schedule, t, classesById, sectionsById, programsById)}</>;
}
