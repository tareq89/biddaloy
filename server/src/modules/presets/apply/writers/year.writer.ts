import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import type { ApplyWriter } from '../apply-context';

/** D23: one current academic year; calendar-year name when the year starts in January. */
export const writeYear: ApplyWriter = async (ctx) => {
  const { startMonth } = ctx.pack.yearShape;
  const { startYear } = ctx.options;
  const name = startMonth === 1 ? String(startYear) : `${startYear}-${startYear + 1}`;
  // Local-time dates: TypeORM serialises `date` columns from local getters.
  const start_date = new Date(startYear, startMonth - 1, 1);
  const end_date = new Date(startYear + 1, startMonth - 1, 0); // day before next start

  const repo = ctx.manager.getRepository(AcademicYear);
  const saved = await repo.save(
    repo.create({ name, start_date, end_date, is_current: true, tenant_id: ctx.tenantId }),
  );
  ctx.ids.yearId = saved.id;
  return { academicYears: 1 };
};
