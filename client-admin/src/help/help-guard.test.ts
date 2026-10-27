// @vitest-environment node
/**
 * [Epic 44 / #2562] Help guard (E6, E22): ids in code, ids in the guide and field keys in i18n
 * must agree. Code -> guide is strict now; guide -> code is report-only until 44.3.12.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HELP_GAPS, HELP_INDEX } from './help-index.gen';
import { HELP_UNWIRED } from './help-unwired';

/** 44.3.12 flips this: every action/field/section/widget id must be wired or listed in HELP_UNWIRED. */
const STRICT_UNUSED = false;

/** Guide pages whose feature id is not in their own helpIds yet (gap for #3017); shrink, never grow. */
const NO_PAGE_ENTRY_YET = new Set([
  'dashboard.widgets',
  'administration.printDesignerGuide',
  'administration.printPrinters',
  'administration.printIdCards',
  'administration.printExamDocuments',
  'administration.printCertificates',
]);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const features = JSON.parse(
  readFileSync(path.join(ROOT, 'docs/user-guide/_generated/features.json'), 'utf8'),
) as { id: string }[];
const SOURCE_DIRS = ['client-admin/src', 'ui/src'];
// ponytail: literals only; a helpId built from a variable is not seen (spread props, ternaries).
const SKIP = /\.(test|stories|gen)\.tsx?$|\.d\.ts$|help-hint\.tsx$/;
const LITERAL = /\bhelpId(?:=\{?\s*["']|:\s*["'])([^"']+)["']/g;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'node_modules'
        ? []
        : walk(path.join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !SKIP.test(e.name)
        ? [path.join(dir, e.name)]
        : [],
  );

const literalsIn = (src: string): string[] => [...src.matchAll(LITERAL)].map((m) => m[1]!);
const unknownIn = (src: string, index: Record<string, unknown>): string[] =>
  literalsIn(src).filter((id) => !Object.hasOwn(index, id));

const codeIds = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((f) =>
  literalsIn(readFileSync(f, 'utf8')),
);
const gapId = (g: string) => g.match(/"([^"]+)"/)![1]!;
const gapIds = HELP_GAPS.map(gapId);
const gapMentions = (id: string) => gapIds.includes(id);

/**
 * Ids the guide declares but the generator cannot index (field help missing, id declared twice,
 * bad anchor), as of 44.1.02. Shrink-only: a new gap or a fixed one fails until this list matches.
 */
const KNOWN_GAPS: string[] = [
  'academics.academicYears.field.dates',
  'academics.academicYears.field.isCurrent',
  'academics.homework.field.target',
  'academics.myRoutine.field.lessonStatus',
  'academics.myRoutine.field.notTaughtReason',
  'academics.routineBuilder.field.recurrence',
  'academics.routineBuilder.field.teachers',
  'academics.routineSetup.field.changeover',
  'academics.routineSetup.field.maxConsecutive',
  'academics.routineSetup.field.maxPeriodsPerDay',
  'academics.routineSubstitutions.field.cancelled',
  'academics.routineSubstitutions.field.substituteTeacher',
  'academics.syllabus.field.periods',
  'academics.syllabus.field.topicStatus',
  'administration.auditLogs.field.performedBy',
  'administration.printTemplates.action.confirmRound',
  'administration.printTemplates.action.makeDefault',
  'administration.printTemplates.action.print',
  'administration.printTemplates.action.publish',
  'administration.printTemplates.action.revoke',
  'administration.printTemplates.field.batchSize',
  'administration.printTemplates.field.design',
  'administration.printTemplates.field.kind',
  'administration.printTemplates.field.printer',
  'attendance.attendanceRegister.field.reason',
  'attendance.attendanceReports.field.threshold',
  'communications.feeReminders.field.guardians',
  'communications.feeReminders.field.medium',
  'communications.feeReminders.field.message',
  'communications.reminderHistory.field.status',
  'communications.sendMessage.field.guardian',
  'communications.sendMessage.field.medium',
  'communications.sendMessage.field.message',
  'examsResults.analysis.field.byPart',
  'examsResults.exams.field.kind',
  'examsResults.exams.field.name',
  'examsResults.marksEntry.field.exam',
  'examsResults.marksEntry.field.mark',
  'examsResults.promotion.field.algorithm',
  'examsResults.promotion.field.exams',
  'examsResults.promotion.field.finalOutcome',
  'examsResults.promotion.field.overrideNote',
  'examsResults.promotion.field.targetClass',
  'finance.dues.field.flagged',
  'finance.payments.field.includeReversed',
  'finance.recurringSchedules.field.audience',
  'finance.recurringSchedules.field.dueDays',
  'finance.recurringSchedules.field.rule',
  'people.admissionApplicants.field.guardianChoice',
  'people.admissionApplicants.field.notes',
  'people.admissionIntakes.field.dates',
  'people.calendar.field.countsAsWorkingDay',
  'people.calendar.field.lateReason',
  'people.calendar.field.notify',
  'people.evaluations.field.minResponses',
  'people.evaluations.field.targets',
  'people.guardians.field.preferredCommunication',
  'people.staff.field.employeeId',
  'people.staffImport.field.sendInvitations',
  'people.students.field.bloodGroup',
  'people.students.field.preferredCommunication',
  'people.students.field.rollNumber',
  'start.signIn.field.identifier',
];

/** Index entries whose default anchor (E10) is not an id="" on the bn or en page. Shrink-only. */
const KNOWN_ANCHOR_GAPS: string[] = [];

const hasAnchor = (lang: string, pagePath: string, anchor: string) =>
  readFileSync(path.join(ROOT, 'docs/user-guide', lang, `${pagePath}.md`), 'utf8').includes(
    `id="${anchor}"`,
  );

describe('help guard', () => {
  it('HELP_GAPS equals the checked-in baseline (shrink-only)', () => {
    expect([...new Set(gapIds)].sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it('every entry anchor exists on the bn and en page, bar the baseline', () => {
    const bad = Object.entries(HELP_INDEX)
      .filter(
        ([, e]) =>
          e.anchor && !(['bn', 'en'] as const).every((l) => hasAnchor(l, e.path, e.anchor)),
      )
      .map(([id]) => id);
    expect(bad.sort()).toEqual([...KNOWN_ANCHOR_GAPS].sort());
  });

  it('NO_PAGE_ENTRY_YET only holds ids that are still missing (shrink-only)', () => {
    expect([...NO_PAGE_ENTRY_YET].filter((id) => Object.hasOwn(HELP_INDEX, id))).toEqual([]);
  });

  it('every helpId literal in code is in HELP_INDEX', () => {
    expect(codeIds.filter((id) => !Object.hasOwn(HELP_INDEX, id))).toEqual([]);
  });

  it('flags an unknown literal in each supported form', () => {
    expect(unknownIn('<PageHeader helpId="nope.page" />', HELP_INDEX)).toEqual(['nope.page']);
    expect(unknownIn("<FormField helpId={'nope.field'} />", HELP_INDEX)).toEqual(['nope.field']);
    expect(unknownIn("const a = { helpId: 'nope.action' }", HELP_INDEX)).toEqual(['nope.action']);
    expect(
      unknownIn('<PageHeader helpId="students.students" />', { 'students.students': {} }),
    ).toEqual([]);
  });

  it('every features.json id is a page entry in HELP_INDEX', () => {
    expect(
      features
        .map((f) => f.id)
        .filter((id) => !Object.hasOwn(HELP_INDEX, id) && !NO_PAGE_ENTRY_YET.has(id)),
    ).toEqual([]);
  });

  it('every .field. id has help.<key> in bn and en of its namespace', () => {
    const missing: string[] = [];
    for (const [id, e] of Object.entries(HELP_INDEX)) {
      if (!id.includes('.field.')) continue;
      for (const lang of ['bn', 'en']) {
        const file = path.join(ROOT, `ui/src/i18n/locales/${lang}/${e.field?.ns}.json`);
        const help = JSON.parse(readFileSync(file, 'utf8')).help as Record<string, unknown>;
        if (!e.field || typeof help?.[e.field.key] !== 'string') missing.push(`${lang}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every HELP_UNWIRED id is in the guide and not used in code', () => {
    const notInGuide = Object.keys(HELP_UNWIRED).filter(
      (id) => !Object.hasOwn(HELP_INDEX, id) && !gapMentions(id),
    );
    expect(notInGuide).toEqual([]);
    expect(codeIds.filter((id) => Object.hasOwn(HELP_UNWIRED, id))).toEqual([]);
  });

  it('reports index ids that no code uses (strict from 44.3.12)', () => {
    const unused = Object.keys(HELP_INDEX).filter(
      (id) =>
        /\.(action|field|section)\.|(^|\.)widget\./.test(id) &&
        !codeIds.includes(id) &&
        !Object.hasOwn(HELP_UNWIRED, id),
    );
    if (STRICT_UNUSED) expect(unused).toEqual([]);
    else if (unused.length) {
      console.warn(`help-guard: ${unused.length} guide ids not wired yet:\n${unused.join('\n')}`);
    }
  });
});
