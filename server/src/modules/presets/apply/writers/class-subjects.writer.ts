import { ClassSubject } from '../../../academics/entities/class-subject.entity';
import { keyOf, selectedClasses, type ApplyWriter } from '../apply-context';

/** One ClassSubject per pack row x selected version of that class. */
export const writeClassSubjects: ApplyWriter = async (ctx) => {
  const selected = selectedClasses(ctx);
  const repo = ctx.manager.getRepository(ClassSubject);
  const keys: string[] = [];
  const rows: ClassSubject[] = [];

  for (const cs of ctx.pack.classSubjects) {
    for (const c of selected.filter((s) => s.numericGrade === cs.classGrade)) {
      const key = keyOf(c.numericGrade, c.version);
      keys.push(`${key}:${cs.subjectCode}`);
      rows.push(
        repo.create({
          class_id: ctx.ids.classIdByKey.get(key)!,
          subject_id: ctx.ids.subjectIdByCode.get(cs.subjectCode)!,
          academic_year_id: ctx.ids.yearId!,
          group_name: cs.group ?? null,
          is_optional: cs.optional ?? false,
          is_graded_only: cs.gradedOnly ?? false,
          tenant_id: ctx.tenantId,
        }),
      );
    }
  }

  const saved = await repo.save(rows);
  saved.forEach((row, i) => ctx.ids.classSubjectIdByKey.set(keys[i], row.id));
  return { classSubjects: saved.length };
};
