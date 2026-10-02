import type { PresetPack } from './pack.types';

const dupes = (xs: (string | number)[]): (string | number)[] =>
  xs.filter((x, i) => xs.indexOf(x) !== i);

/** Pure structural check of a preset pack. Returns human-readable errors; empty = valid. */
export function validatePresetPack(pack: PresetPack): string[] {
  const errs: string[] = [];
  if (!pack.id?.trim()) errs.push('id must not be empty');
  if (!pack.version?.trim()) errs.push('version must not be empty');

  const m = pack.yearShape?.startMonth;
  if (!Number.isInteger(m) || m < 1 || m > 12) errs.push('yearShape.startMonth must be 1-12');

  const stageKeys = pack.stages.map((s) => s.key);
  for (const k of new Set(dupes(stageKeys))) errs.push(`duplicate stage key: ${k}`);
  for (const c of pack.classes) {
    if (!stageKeys.includes(c.stage))
      errs.push(`class ${c.name} references unknown stage: ${c.stage}`);
  }

  const grades = pack.classes.map((c) => c.numericGrade);
  for (const g of new Set(dupes(grades))) errs.push(`duplicate numericGrade: ${g}`);

  const codes = pack.subjects.map((s) => s.code);
  for (const c of new Set(dupes(codes))) errs.push(`duplicate subject code: ${c}`);

  for (const cs of pack.classSubjects) {
    const at = `classSubject ${cs.classGrade}/${cs.subjectCode}`;
    if (!grades.includes(cs.classGrade)) errs.push(`${at}: unknown class grade`);
    if (!codes.includes(cs.subjectCode)) errs.push(`${at}: unknown subject code`);
    if (cs.group !== undefined && !pack.groups.includes(cs.group)) {
      errs.push(`${at}: unknown group: ${cs.group}`);
    }
    if (cs.group !== undefined && cs.optional)
      errs.push(`${at}: cannot be both group and optional`);
  }

  const bands = pack.gradingScale?.bands;
  if (bands) {
    if (bands.length === 0) errs.push('gradingScale must have at least one band');
    bands.forEach((b, i) => {
      if (b.from > b.to) errs.push(`grading band ${b.grade}: from is greater than to`);
      const prev = bands[i - 1];
      if (prev) {
        if (b.from <= prev.to)
          errs.push(`grading bands ${prev.grade} and ${b.grade} are unsorted or overlap`);
        else if (b.from - prev.to > 1)
          errs.push(`grading bands have a gap between ${prev.grade} and ${b.grade}`);
      }
    });
    if (bands.length && bands[0].from !== 0) errs.push('grading bands must start at 0');
    if (bands.length && bands[bands.length - 1].to !== 100)
      errs.push('grading bands must end at 100');
    const firstPass = bands.findIndex((b) => !b.isFail);
    const lastFail = bands.map((b) => b.isFail).lastIndexOf(true);
    if (firstPass !== -1 && lastFail > firstPass)
      errs.push('only the lowest grading bands may be isFail');
  }

  // Mirrors UQ_exam_templates_tenant_name and UQ_exam_template_components_natural.
  for (const n of new Set(dupes(pack.examTemplates.map((t) => t.name))))
    errs.push(`duplicate template name: ${n}`);
  for (const t of pack.examTemplates) {
    const rowKeys = new Set<string>();
    t.rows.forEach((r) => {
      const at = `template ${t.name} row ${r.classGrade}/${r.subjectCode}`;
      if (!grades.includes(r.classGrade)) errs.push(`${at}: unknown class grade`);
      if (!codes.includes(r.subjectCode)) errs.push(`${at}: unknown subject code`);
      const rowKey = `${r.classGrade}|${r.subjectCode}`;
      if (rowKeys.has(rowKey)) errs.push(`${at}: duplicate row`);
      rowKeys.add(rowKey);
      for (const n of new Set(dupes(r.components.map((c) => c.name))))
        errs.push(`${at}: duplicate component ${n}`);
      for (const c of r.components) {
        if (!(c.full > 0)) errs.push(`${at} component ${c.name}: full must be > 0`);
        else if (c.pass < 0 || c.pass > c.full)
          errs.push(`${at} component ${c.name}: need full >= pass >= 0`);
      }
    });
  }

  for (const s of new Set(dupes(pack.terms.map((t) => t.seq))))
    errs.push(`duplicate term seq: ${s}`);
  for (const t of pack.terms) {
    // ponytail: month/day comparison only; year-wrapping terms would need a year-shape-aware check
    if (t.start.month * 100 + t.start.day >= t.end.month * 100 + t.end.day) {
      errs.push(`term ${t.name}: start must be before end`);
    }
  }

  return errs;
}
