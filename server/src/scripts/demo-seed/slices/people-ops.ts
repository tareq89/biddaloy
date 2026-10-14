import { AdmissionApplicantStatus, AdmissionDocumentType } from '@biddaloy/shared';
import { AcrFormVersion } from '../../../modules/acr/entities/acr-form-version.entity';
import { AcrCriterion } from '../../../modules/acr/entities/acr-criterion.entity';
import { AcrAssessment } from '../../../modules/acr/entities/acr-assessment.entity';
import { AcrScore } from '../../../modules/acr/entities/acr-score.entity';
import { Survey } from '../../../modules/surveys/entities/survey.entity';
import { SurveyQuestion } from '../../../modules/surveys/entities/survey-question.entity';
import { SurveyTarget } from '../../../modules/surveys/entities/survey-target.entity';
import { SurveyResponse } from '../../../modules/surveys/entities/survey-response.entity';
import { SurveyAnswer } from '../../../modules/surveys/entities/survey-answer.entity';
import { StaffIncident } from '../../../modules/incidents/entities/staff-incident.entity';
import { AdmissionIntake } from '../../../modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../../../modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from '../../../modules/admission/entities/admission-evaluation.entity';
import { ACR_DEFAULT_CRITERIA } from '../../seed.evaluations';
import { ADMISSION_NOTES } from '../../seed-data/demo-bn/texts';
import { NAME_POOLS } from '../../seed-data/demo-bn/names';
import { DHAKA_AREAS } from '../../seed-data/demo-bn/places';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { orgIds } from './org';
import { studentIds } from './students';
import { teachersByTenant } from './staff';

/**
 * [58.3.05] People operations: yearly ACRs for every teacher, student-feedback surveys, a few staff
 * incidents (one withdrawn) and an open admission intake with applicants in every status.
 * Bulk-inserted (D38); applicants skip the public controller, so no captcha is involved.
 */

const DAY = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
const bnNum = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const ACR_YEARS = 3;
const CURRENT_COMPLETED_RATE = 0.7;
const INCIDENTS_PER_BRANCH = 3;
const RESPONSE_RATE = 0.4;
const SURVEY_TARGETS = 6;
const APPLICANTS = 120;
/** Class grade of the intake per branch kind, and the age of a child applying to it. */
const INTAKE_GRADE = { PRIMARY: 1, HIGH: 6, COLLEGE: 11 } as const;
const APPLICANT_AGE = { PRIMARY: 6, HIGH: 11, COLLEGE: 16 } as const;
const STATUS_WEIGHTS = [
  [AdmissionApplicantStatus.PENDING, 45],
  [AdmissionApplicantStatus.SHORTLISTED, 25],
  [AdmissionApplicantStatus.ADMITTED, 15],
  [AdmissionApplicantStatus.REJECTED, 15],
] as const;
const DECISION = {
  [AdmissionApplicantStatus.SHORTLISTED]: 'SHORTLIST',
  [AdmissionApplicantStatus.ADMITTED]: 'ADMIT',
  [AdmissionApplicantStatus.REJECTED]: 'REJECT',
} as const;
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // as the public form generates

const INCIDENTS = [
  ['COMMENDATION', 'LOW', 'বার্ষিক বিজ্ঞান মেলা সফলভাবে আয়োজন করেছেন।'],
  ['ABSENCE', 'MEDIUM', 'পরীক্ষার দিনে পূর্বঘোষণা ছাড়া অনুপস্থিত ছিলেন।'],
  ['COMPLAINT', 'MEDIUM', 'অভিভাবকের অভিযোগ: ক্লাসে খাতা ফেরত দিতে দেরি হয়েছে।'],
  ['BEHAVIOUR', 'LOW', 'সহকর্মীদের সঙ্গে সভায় দেরিতে উপস্থিত হয়েছেন।'],
] as const;
const WITHDRAW_REASON = 'ভুল শিক্ষকের নামে নথিভুক্ত হয়েছিল, তাই প্রত্যাহার করা হলো।';
const QUESTIONS = [
  ['শিক্ষক কতটা স্পষ্টভাবে পড়ান?', true],
  ['ক্লাসে প্রশ্ন করার সুযোগ পান কি?', true],
  ['আরও কিছু বলতে চাইলে লিখুন।', false],
] as const;
const COMMENTS = [
  'পড়ানোর পদ্ধতি খুব ভালো লাগে।',
  'আরও উদাহরণ দিয়ে বুঝিয়ে দিলে ভালো হয়।',
  'ক্লাসে মাঝে মাঝে কথা বলার সুযোগ বেশি চাই।',
];

export const slice: DemoSlice = {
  name: 'people-ops',
  covers: [
    AcrFormVersion,
    AcrCriterion,
    AcrAssessment,
    AcrScore,
    Survey,
    SurveyQuestion,
    SurveyTarget,
    SurveyResponse,
    SurveyAnswer,
    StaffIncident,
    AdmissionIntake,
    AdmissionApplicant,
    AdmissionEvaluation,
  ],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const staff = teachersByTenant(ctx);
    const { students } = studentIds(ctx);
    const uuid = () => ctx.rng.string.uuid();
    const repo = (e: Function) => ctx.ds.getRepository(e as never);
    const admin = org.adminUserId;
    const stamp = (date: string, hh: number) =>
      `${date}T${String(hh).padStart(2, '0')}:00:00+06:00`;
    let rows = 0;

    const forms: Record<string, unknown>[] = [];
    const criteria: Record<string, unknown>[] = [];
    const assessments: Record<string, unknown>[] = [];
    const scores: Record<string, unknown>[] = [];
    const incidents: Record<string, unknown>[] = [];
    const surveys: Record<string, unknown>[] = [];
    const questions: Record<string, unknown>[] = [];
    const targets: Record<string, unknown>[] = [];
    const responses: Record<string, unknown>[] = [];
    const answers: Record<string, unknown>[] = [];
    const intakes: Record<string, unknown>[] = [];
    const applicants: Record<string, unknown>[] = [];
    const evaluations: Record<string, unknown>[] = [];

    const nextYear = String(Number(ctx.anchor.slice(0, 4)) + 1);
    const references = new Set<string>();

    for (const t of org.tenants) {
      const teachers = staff.get(t.id) ?? [];
      const cur = t.years[t.years.length - 1];

      // ---- 1. ACR: form v1 with the 25 default criteria, one assessment per teacher per year -----
      const formId = uuid();
      forms.push({ id: formId, tenant_id: t.id, version: 1, created_by: admin });
      const criterionIds = ACR_DEFAULT_CRITERIA.map(([block, code, en, bn], i) => {
        const id = uuid();
        criteria.push({
          id,
          tenant_id: t.id,
          form_version_id: formId,
          block,
          code,
          label_en: en,
          label_bn: bn,
          sort_order: i,
        });
        return id;
      });
      for (const year of t.years.slice(-ACR_YEARS)) {
        for (const teacher of teachers) {
          const isCurrent = year === cur;
          const done = !isCurrent || ctx.rng.number.float() < CURRENT_COMPLETED_RATE;
          // An unfinished ACR has only the first block scored, like the reference seed.
          const scored = done ? criterionIds : criterionIds.slice(0, 5);
          const id = uuid();
          const marks = scored.map(() =>
            ctx.weighted([
              [1, 5],
              [2, 15],
              [3, 40],
              [4, 40],
            ] as const),
          );
          assessments.push({
            id,
            tenant_id: t.id,
            user_id: teacher.userId,
            academic_year_id: year.id,
            form_version_id: formId,
            status: done ? 'COMPLETED' : 'INCOMPLETE',
            total: done ? marks.reduce((a, b) => a + b, 0) : null,
            assessed_by: admin,
            step1_data: null,
            step3_data: null,
            completed_at: done ? stamp(isCurrent ? addDays(ctx.anchor, -1) : year.end, 10) : null,
          });
          scored.forEach((criterionId, i) =>
            scores.push({
              tenant_id: t.id,
              assessment_id: id,
              criterion_id: criterionId,
              score: marks[i],
            }),
          );
        }
      }

      // ---- 3. staff incidents: ~3 per branch over the span, the last one withdrawn --------------
      const span = Math.max(1, ctx.years) * 365;
      for (let i = 0; i < INCIDENTS_PER_BRANCH && teachers.length; i++) {
        const [type, severity, body] = INCIDENTS[i % INCIDENTS.length];
        const withdrawn = i === INCIDENTS_PER_BRANCH - 1;
        incidents.push({
          tenant_id: t.id,
          staff_user_id: teachers[ctx.rng.number.int({ min: 0, max: teachers.length - 1 })].userId,
          type,
          severity,
          body,
          occurred_on: addDays(ctx.anchor, -ctx.rng.number.int({ min: 5, max: span })),
          reported_by: admin,
          withdrawn_at: withdrawn ? stamp(addDays(ctx.anchor, -2), 11) : null,
          withdrawn_by_user_id: withdrawn ? admin : null,
          withdraw_reason: withdrawn ? WITHDRAW_REASON : null,
        });
      }

      // ---- 2. surveys: one student-feedback survey per term that has started --------------------
      const terms: { name: string; start_date: string; end_date: string }[] = await ctx.ds.query(
        `SELECT name, start_date::text, end_date::text FROM academic_terms
          WHERE tenant_id = $1 AND academic_year_id = $2 AND start_date <= $3 ORDER BY seq`,
        [t.id, cur.id, ctx.anchor],
      );
      // Teacher and subject pairs come from the routine: a teacher's first subject, in roster order.
      const pairs: { teacher_id: string; subject_id: string }[] = await ctx.ds.query(
        `SELECT DISTINCT ON (rst.teacher_id) rst.teacher_id, rs.subject_id
           FROM routine_slot_teachers rst JOIN routine_slots rs ON rs.id = rst.routine_slot_id
           JOIN subjects s ON s.id = rs.subject_id
          WHERE rs.tenant_id = $1 ORDER BY rst.teacher_id, s.code`,
        [t.id],
      );
      const subjectOf = new Map(pairs.map((p) => [p.teacher_id, p.subject_id] as const));
      const picked = teachers
        .filter((x) => subjectOf.has(x.teacherId))
        .slice(0, SURVEY_TARGETS)
        .map((x) => ({ teacherId: x.teacherId, subjectId: subjectOf.get(x.teacherId)! }));
      // Only students who have a login can answer; ~40% of them do (at least one per survey).
      const loginStudents = students.filter((s) => s.tenantId === t.id && s.userId);
      for (const term of terms) {
        const open = term.end_date >= ctx.anchor;
        const surveyId = uuid();
        surveys.push({
          id: surveyId,
          tenant_id: t.id,
          title: `শিক্ষার্থী মতামত: ${term.name}`,
          status: open ? 'OPEN' : 'CLOSED',
          anonymous: true,
          respondent: 'STUDENTS',
          opens_at: stamp(term.start_date, 8),
          closes_at: open ? null : stamp(term.end_date, 16),
          // ponytail: the demo has only a handful of student logins per branch, so min-N is 1.
          min_responses: 1,
        });
        const questionIds = QUESTIONS.map(([text, stars], i) => {
          const id = uuid();
          questions.push({
            id,
            tenant_id: t.id,
            survey_id: surveyId,
            sort_order: i,
            text,
            stars_enabled: stars,
          });
          return id;
        });
        for (const p of picked) {
          targets.push({
            tenant_id: t.id,
            survey_id: surveyId,
            teacher_id: p.teacherId,
            subject_id: p.subjectId,
          });
        }
        loginStudents
          .filter((_, i) => i === 0 || ctx.rng.number.float() < RESPONSE_RATE)
          .forEach((student) => {
            for (const p of picked) {
              const responseId = uuid();
              responses.push({
                id: responseId,
                tenant_id: t.id,
                survey_id: surveyId,
                respondent_user_id: student.userId,
                teacher_id: p.teacherId,
                subject_id: p.subjectId,
              });
              for (const qid of questionIds.slice(0, 2)) {
                answers.push({
                  tenant_id: t.id,
                  response_id: responseId,
                  question_id: qid,
                  text: null,
                  stars: ctx.weighted([
                    [3, 25],
                    [4, 40],
                    [5, 35],
                  ] as const),
                });
              }
              if (ctx.rng.number.float() < 0.3) {
                answers.push({
                  tenant_id: t.id,
                  response_id: responseId,
                  question_id: questionIds[2],
                  text: ctx.pick(COMMENTS),
                  stars: null,
                });
              }
            }
          });
      }

      // ---- 4. admission: one open intake for next year, applicants in every status --------------
      const klass = cur.classes.find((c) => c.numericGrade === INTAKE_GRADE[t.kind]);
      if (!klass) continue;
      const intakeId = uuid();
      intakes.push({
        id: intakeId,
        tenant_id: t.id,
        class_section_id: klass.sections[0].id,
        title: `ভর্তি ${bnNum(Number(nextYear))}: ${klass.name}`,
        seat_count: 40,
        open_date: addDays(ctx.anchor, -30),
        close_date: addDays(ctx.anchor, 30),
        required_document_types: [
          AdmissionDocumentType.PHOTO,
          AdmissionDocumentType.BIRTH_CERTIFICATE,
        ],
      });
      const count = Math.max(8, Math.round(ctx.count(APPLICANTS) / org.tenants.length));
      const age = APPLICANT_AGE[t.kind];
      const seenChild = new Set<string>();
      const makeApplicant = (
        i: number,
        twinOf?: { phone: string; dob: string; surname: string },
      ) => {
        const group = ctx.weighted([
          ['MUSLIM', 92],
          ['HINDU', 8],
        ] as const);
        const pool = NAME_POOLS[group];
        const gender = ctx.pick(['MALE', 'FEMALE'] as const);
        const given = ctx.pick(gender === 'MALE' ? pool.boys : pool.girls);
        const surname = twinOf ? { en: twinOf.surname } : ctx.pick(pool.surnames);
        const phone = twinOf?.phone ?? ctx.nextPhone();
        const dob =
          twinOf?.dob ??
          addDays(ctx.anchor, -(age * 365 + ctx.rng.number.int({ min: 0, max: 364 })));
        const name = `${given.en} ${surname.en}`;
        if (seenChild.has(`${phone}|${dob}|${name}`)) return null;
        seenChild.add(`${phone}|${dob}|${name}`);
        let reference: string;
        do {
          reference = `ADM-${ctx.anchor.slice(0, 4)}-${ctx.rng.string.fromCharacters(REFERENCE_ALPHABET, 6)}`;
        } while (references.has(reference));
        references.add(reference);
        // The first four cover every status, so a tiny scale still shows them all.
        const status =
          i < STATUS_WEIGHTS.length ? STATUS_WEIGHTS[i][0] : ctx.weighted(STATUS_WEIGHTS);
        const id = uuid();
        applicants.push({
          id,
          tenant_id: t.id,
          intake_id: intakeId,
          reference_number: reference,
          applicant_name: name,
          date_of_birth: dob,
          gender,
          guardian_name: `${ctx.pick(pool.boys).en} ${surname.en}`,
          guardian_phone: phone,
          guardian_email: null,
          home_address: `${ctx.pick(DHAKA_AREAS).bn}, ঢাকা`,
          documents: [],
          status,
        });
        if (status !== AdmissionApplicantStatus.PENDING) {
          evaluations.push({
            tenant_id: t.id,
            applicant_id: id,
            reviewer_user_id: admin,
            notes: ctx.pick(ADMISSION_NOTES),
            decision: DECISION[status],
          });
        }
        return { phone, dob, surname: surname.en };
      };
      // Twins under one guardian phone (Epic 68 LIFE-10: one application per child).
      const first = makeApplicant(0);
      if (first) makeApplicant(1, first);
      for (let i = 2; i < count; i++) makeApplicant(i);
    }

    rows += await insertChunked(repo(AcrFormVersion) as never, forms as never);
    rows += await insertChunked(repo(AcrCriterion) as never, criteria as never);
    rows += await insertChunked(repo(AcrAssessment) as never, assessments as never);
    rows += await insertChunked(repo(AcrScore) as never, scores as never, 2000);
    rows += await insertChunked(repo(StaffIncident) as never, incidents as never);
    rows += await insertChunked(repo(Survey) as never, surveys as never);
    rows += await insertChunked(repo(SurveyQuestion) as never, questions as never);
    rows += await insertChunked(repo(SurveyTarget) as never, targets as never);
    rows += await insertChunked(repo(SurveyResponse) as never, responses as never);
    rows += await insertChunked(repo(SurveyAnswer) as never, answers as never, 2000);
    rows += await insertChunked(repo(AdmissionIntake) as never, intakes as never);
    rows += await insertChunked(repo(AdmissionApplicant) as never, applicants as never);
    rows += await insertChunked(repo(AdmissionEvaluation) as never, evaluations as never);
    return rows;
  },
};
