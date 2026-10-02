import { ExamTemplateComponent } from '../../../exams/entities/exam-template-component.entity';
import { ExamTemplate } from '../../../exams/entities/exam-template.entity';
import { selectedClasses, type ApplyWriter } from '../apply-context';

/** Templates with only the rows for selected classes whose subject was created; empty templates are skipped. */
export const writeExamTemplates: ApplyWriter = async (ctx) => {
  const grades = new Set(selectedClasses(ctx).map((c) => c.numericGrade));
  const tplRepo = ctx.manager.getRepository(ExamTemplate);
  const compRepo = ctx.manager.getRepository(ExamTemplateComponent);
  let templates = 0;
  let components = 0;

  for (const t of ctx.pack.examTemplates) {
    const rows = t.rows.filter(
      (r) => grades.has(r.classGrade) && ctx.ids.subjectIdByCode.has(r.subjectCode),
    );
    if (!rows.length) continue;

    const tpl = await tplRepo.save(
      tplRepo.create({ tenant_id: ctx.tenantId, name: t.name, kind: t.kind }),
    );
    const lines = rows.flatMap((r) =>
      r.components.map((c, sequence) =>
        compRepo.create({
          tenant_id: ctx.tenantId,
          template_id: tpl.id,
          class_grade: r.classGrade,
          subject_code: r.subjectCode,
          sequence,
          name: c.name,
          kind: c.kind,
          full_marks: String(c.full),
          pass_marks: String(c.pass),
        }),
      ),
    );
    await compRepo.save(lines);
    templates += 1;
    components += lines.length;
  }
  return { exam_templates: templates, exam_template_components: components };
};
