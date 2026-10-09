import { InternalServerErrorException } from '@nestjs/common';
import { GradingBand } from '../../../grading/entities/grading-band.entity';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { validateBands } from '../../../grading/band-validation';
import type { ApplyWriter } from '../apply-context';

/** The year's default scale (class_id null) plus its bands. */
export const writeGradingScale: ApplyWriter = async (ctx) => {
  const scale = ctx.pack.gradingScale;
  if (!scale) return {} as Record<string, number>;

  const bands = scale.bands.map((b, sequence) => ({
    percent_from: b.from,
    percent_to: b.to,
    grade: b.grade,
    gpa: b.gpa == null ? null : String(b.gpa),
    is_fail: b.isFail,
    sequence,
    comment: null,
  }));
  const problems = validateBands(bands);
  if (problems.length) {
    throw new InternalServerErrorException(
      `preset grading bands invalid: ${problems.map((p) => p.message).join('; ')}`,
    );
  }

  const scaleRepo = ctx.manager.getRepository(GradingScale);
  const saved = await scaleRepo.save(
    scaleRepo.create({
      tenant_id: ctx.tenantId,
      academic_year_id: ctx.ids.yearId!,
      class_id: null,
      name: scale.name,
      revision: 1,
    }),
  );
  const bandRepo = ctx.manager.getRepository(GradingBand);
  await bandRepo.save(
    bands.map((b) => bandRepo.create({ ...b, tenant_id: ctx.tenantId, scale_id: saved.id })),
  );
  return { grading_scales: 1, grading_bands: bands.length };
};
