import { readFileSync } from 'fs';
import { join } from 'path';
import { EnrollmentStatus, PublicExamType } from '@biddaloy/shared';
import { StorageService } from '../../../modules/storage/storage.service';
import { tenantObjectKeyNamed } from '../../../modules/storage/storage-key';
import { StudentSubjectChoice } from '../../../modules/students/entities/student-subject-choice.entity';
import { StudentNote } from '../../../modules/students/entities/student-note.entity';
import { StudentPublicExam } from '../../../modules/students/entities/student-public-exam.entity';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { orgIds } from './org';
import { studentIds } from './students';

/**
 * [58.2.04] What makes student profiles, ID cards and admit cards look complete (D22, D34):
 * photos, College group subject choices, teachers' notes and SSC/HSC results of graduates.
 * Staff faces are not here: no staff table has a photo storage key (User.profile_picture_url
 * is a plain URL).
 */

const AVATARS = 24; // 01-12 boys, 13-24 girls
const NOTE_RATE = 0.1;
const FOURTH_RATE = 0.5; // of Science students take the optional subject as their fourth
/** Short teacher notes in Bangla (praise and gentle concern). */
const NOTE_PHRASES = [
  'ক্লাসে মনোযোগী এবং নিয়মিত বাড়ির কাজ জমা দেয়।',
  'গণিতে আরও অনুশীলনের প্রয়োজন, অভিভাবককে জানানো হয়েছে।',
  'বিতর্ক প্রতিযোগিতায় ভালো ফল করেছে।',
  'সহপাঠীদের সঙ্গে সহযোগিতামূলক আচরণ করে।',
  'কিছুদিন ক্লাসে অনুপস্থিত ছিল, কারণ জানা গেছে।',
  'পড়ায় উন্নতি হচ্ছে, উৎসাহ দেওয়া প্রয়োজন।',
] as const;
/** GPA ranges on the NCTB 5.00 scale and their weights: ~10% perfect 5.00. */
const GPA_RANGES = [
  [[5, 5], 10],
  [[4.5, 4.99], 35],
  [[4, 4.49], 30],
  [[3.5, 3.99], 15],
  [[3, 3.49], 8],
  [[2, 2.99], 2],
] as const;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

export const slice: DemoSlice = {
  name: 'student-extras',
  covers: [StudentSubjectChoice, StudentNote, StudentPublicExam],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const { students } = studentIds(ctx);
    const storage = ctx.app.get(StorageService);
    let rows = 0;

    // Where every class, section and year sits, to read back what a stay means.
    const classInfo = new Map<
      string,
      { grade: number; kind: string; yearIdx: number; end: string }
    >();
    const groupOf = new Map<string, string | null>();
    for (const t of org.tenants) {
      t.years.forEach((y, yearIdx) =>
        y.classes.forEach((c) => {
          classInfo.set(c.id, { grade: c.numericGrade, kind: t.kind, yearIdx, end: y.end });
          c.sections.forEach((s) => groupOf.set(s.id, s.group));
        }),
      );
    }
    const lastStay = (s: (typeof students)[number]) => s.stays[s.stays.length - 1];

    // ---- 1. photos: 24 objects per branch, reused (D22) --------------------------------------
    const avatar = (i: number) =>
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          'seed-data',
          'demo-avatars',
          `avatar-${String(i).padStart(2, '0')}.png`,
        ),
      );
    const keysByTenant = new Map<string, string[]>();
    for (const t of org.tenants) {
      const keys: string[] = [];
      for (let i = 1; i <= AVATARS; i++) {
        // Named (not random) keys: the same seed must give the same data.
        const key = tenantObjectKeyNamed(t.id, 'student-photo', ctx.rng.string.uuid(), 'png');
        await storage.put(key, avatar(i), 'image/png');
        keys.push(key);
      }
      keysByTenant.set(t.id, keys);
    }
    rows += keysByTenant.size * AVATARS;
    const ids: string[] = [];
    const photoKeys: string[] = [];
    for (const s of students) {
      const keys = keysByTenant.get(s.tenantId)!;
      const half = AVATARS / 2;
      const pick = ctx.rng.number.int({ min: 0, max: half - 1 }) + (s.gender === 'MALE' ? 0 : half);
      ids.push(s.id);
      photoKeys.push(keys[pick]);
    }
    for (let i = 0; i < ids.length; i += 2000) {
      await ctx.ds.query(
        `UPDATE students st SET photo_key = u.k
           FROM unnest($1::uuid[], $2::text[]) AS u(id, k) WHERE st.id = u.id`,
        [ids.slice(i, i + 2000), photoKeys.slice(i, i + 2000)],
      );
    }
    rows += ids.length;

    // ---- 2. College subject choices: the subjects of the student's own group -----------------
    const college = org.tenants.find((t) => t.kind === 'COLLEGE');
    if (college) {
      const recent = college.years.slice(-2).map((y) => y.id);
      const subjects: {
        id: string;
        class_id: string;
        academic_year_id: string;
        group_name: string | null;
        is_optional: boolean;
      }[] = await ctx.ds.query(
        `SELECT id, class_id, academic_year_id, group_name, is_optional FROM class_subjects
            WHERE tenant_id = $1 AND academic_year_id = ANY($2) AND deleted_at IS NULL`,
        [college.id, recent],
      );
      const byClass = new Map<string, typeof subjects>();
      for (const cs of subjects)
        (byClass.get(cs.class_id) ?? byClass.set(cs.class_id, []).get(cs.class_id)!).push(cs);
      const choices: Record<string, unknown>[] = [];
      for (const s of students.filter((x) => x.tenantId === college.id)) {
        for (const stay of s.stays.filter((st) => recent.includes(st.yearId))) {
          const group = groupOf.get(stay.sectionId);
          const offered = byClass.get(stay.classId) ?? [];
          const mine = offered.filter((cs) => group && cs.group_name === group);
          const optional = offered.find((cs) => cs.is_optional);
          const row = (cs: { id: string }, fourth: boolean) => ({
            tenant_id: college.id,
            student_id: s.id,
            class_subject_id: cs.id,
            academic_year_id: stay.yearId,
            is_fourth: fourth,
          });
          choices.push(...mine.map((cs) => row(cs, false)));
          if (group === 'Science' && optional && ctx.rng.number.float() < FOURTH_RATE) {
            choices.push(row(optional, true));
          }
        }
      }
      rows += await insertChunked(ctx.ds.getRepository(StudentSubjectChoice), choices as never);
    }

    // ---- 3. teachers' notes: ~1 per 10 current students, written by the class teacher --------
    const noteRows: Record<string, unknown>[] = [];
    const classTeacher = new Map<string, string>();
    for (const t of org.tenants) {
      const found: { section_id: string; user_id: string }[] = await ctx.ds.query(
        `SELECT tcs.section_id, te.user_id FROM teacher_class_sections tcs
           JOIN teachers te ON te.id = tcs.teacher_id
          WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'CLASS_TEACHER'`,
        [t.id],
      );
      found.forEach((f) => classTeacher.set(f.section_id, f.user_id));
    }
    for (const s of students) {
      if (s.status !== EnrollmentStatus.ACTIVE || ctx.rng.number.float() >= NOTE_RATE) continue;
      noteRows.push({
        tenant_id: s.tenantId,
        student_id: s.id,
        author_user_id: classTeacher.get(lastStay(s).sectionId) ?? org.adminUserId,
        body: ctx.pick(NOTE_PHRASES),
        rating: ctx.rng.number.int({ min: 2, max: 5 }),
        created_at: `${addDays(ctx.anchor, -ctx.rng.number.int({ min: 1, max: 120 }))}T09:00:00+06:00`,
      });
    }
    rows += await insertChunked(ctx.ds.getRepository(StudentNote), noteRows as never);

    // ---- 4. public exams: SSC for class 10 graduates, HSC for class 12 (D34) ------------------
    const exams: Record<string, unknown>[] = [];
    let roll = 100000;
    for (const s of students.filter((x) => x.status === EnrollmentStatus.GRADUATED)) {
      const info = classInfo.get(lastStay(s).classId)!;
      const type =
        info.grade === 10 ? PublicExamType.SSC : info.grade === 12 ? PublicExamType.HSC : null;
      if (!type) continue;
      const [min, max] = ctx.weighted(GPA_RANGES.map((r) => [r[0], r[1]] as const));
      roll += ctx.rng.number.int({ min: 1, max: 9 });
      exams.push({
        tenant_id: s.tenantId,
        student_id: s.id,
        exam_type: type,
        board: 'Dhaka',
        roll_no: String(roll),
        registration_no: `REG-${roll}`,
        gpa: (min === max ? min : ctx.rng.number.float({ min, max, fractionDigits: 2 })).toFixed(2),
        passing_year: Number(info.end.slice(0, 4)),
      });
    }
    rows += await insertChunked(ctx.ds.getRepository(StudentPublicExam), exams as never);
    return rows;
  },
};
