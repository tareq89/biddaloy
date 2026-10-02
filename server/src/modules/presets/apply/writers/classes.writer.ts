import { BadRequestException } from '@nestjs/common';
import { Class } from '../../../academics/entities/class.entity';
import { keyOf, selectedClasses, type ApplyWriter } from '../apply-context';

/** One Class per selected stage-class x selected version. */
export const writeClasses: ApplyWriter = async (ctx) => {
  const { pack } = ctx;
  const versionKeys = new Set((pack.versions ?? []).map((v) => v.key));
  const selected = selectedClasses(ctx);
  for (const c of selected) {
    if (c.version !== null && !versionKeys.has(c.version)) {
      throw new BadRequestException('preset.unknown_version');
    }
  }

  const repo = ctx.manager.getRepository(Class);
  const rows = await repo.save(
    selected.map((c) =>
      repo.create({
        name: c.name,
        numeric_grade: c.numericGrade,
        version: c.version,
        shift: null,
        academic_year_id: ctx.ids.yearId!,
        tenant_id: ctx.tenantId,
      }),
    ),
  );
  rows.forEach((row, i) =>
    ctx.ids.classIdByKey.set(keyOf(selected[i].numericGrade, selected[i].version), row.id),
  );
  return { classes: rows.length };
};
