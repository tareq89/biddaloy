import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Subject } from '../../../academics/entities/subject.entity';
import { selectedClasses, type ApplyWriter } from '../apply-context';

/** Only subjects used by at least one selected class. */
export const writeSubjects: ApplyWriter = async (ctx) => {
  const { pack } = ctx;
  const grades = new Set(selectedClasses(ctx).map((c) => c.numericGrade));
  const usedCodes = new Set(
    pack.classSubjects.filter((cs) => grades.has(cs.classGrade)).map((cs) => cs.subjectCode),
  );
  const subjects = pack.subjects.filter((s) => usedCodes.has(s.code));

  const repo = ctx.manager.getRepository(Subject);
  let rows: Subject[];
  try {
    rows = await repo.save(
      subjects.map((s) =>
        repo.create({
          name_en: s.nameEn,
          name_bn: s.nameBn,
          code: s.code,
          is_active: true,
          tenant_id: ctx.tenantId,
        }),
      ),
    );
  } catch (e) {
    if (e instanceof QueryFailedError && (e.driverError as { code?: string })?.code === '23505') {
      throw new ConflictException('preset.subject_code_conflict');
    }
    throw e;
  }
  rows.forEach((row, i) => ctx.ids.subjectIdByCode.set(subjects[i].code, row.id));
  return { subjects: rows.length };
};
