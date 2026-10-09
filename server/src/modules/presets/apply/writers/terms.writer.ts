import { InternalServerErrorException } from '@nestjs/common';
import { AcademicTerm } from '../../../calendar/entities/academic-term.entity';
import type { ApplyWriter } from '../apply-context';

const pad = (n: number) => String(n).padStart(2, '0');

/** Terms for the year; a month earlier than the year's start month falls in the next calendar year. */
export const writeTerms: ApplyWriter = async (ctx) => {
  const { startMonth } = ctx.pack.yearShape;
  const { startYear } = ctx.options;
  const date = (d: { month: number; day: number }) =>
    `${d.month < startMonth ? startYear + 1 : startYear}-${pad(d.month)}-${pad(d.day)}`;

  const rows = ctx.pack.terms.map((t) => ({
    ...t,
    start_date: date(t.start),
    end_date: date(t.end),
  }));
  // ISO dates compare lexically; the manager path skips the service's overlap check.
  const sorted = [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date));
  sorted.forEach((t, i) => {
    if (t.end_date < t.start_date || (i > 0 && t.start_date <= sorted[i - 1].end_date)) {
      throw new InternalServerErrorException(`preset terms overlap or invert: ${t.name}`);
    }
  });

  const repo = ctx.manager.getRepository(AcademicTerm);
  const saved = await repo.save(
    rows.map((t) =>
      repo.create({
        tenant_id: ctx.tenantId,
        academic_year_id: ctx.ids.yearId!,
        seq: t.seq,
        name: t.name,
        start_date: t.start_date,
        end_date: t.end_date,
      }),
    ),
  );
  return { academic_terms: saved.length };
};
