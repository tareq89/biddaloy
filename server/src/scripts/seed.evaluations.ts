import type { Repository } from 'typeorm';
import { UserRole, UserStatus } from '@biddaloy/shared';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Subject } from '../modules/academics/entities/subject.entity';
import type { Teacher } from '../modules/academics/entities/teacher.entity';
import type { AcrAssessment } from '../modules/acr/entities/acr-assessment.entity';
import type { AcrCriterion } from '../modules/acr/entities/acr-criterion.entity';
import type { AcrFormVersion } from '../modules/acr/entities/acr-form-version.entity';
import type { AcrScore } from '../modules/acr/entities/acr-score.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import type { StaffIncident } from '../modules/incidents/entities/staff-incident.entity';
import type { Student } from '../modules/students/entities/student.entity';
import type { StudentNote } from '../modules/students/entities/student-note.entity';
import type { Survey } from '../modules/surveys/entities/survey.entity';
import type { SurveyAnswer } from '../modules/surveys/entities/survey-answer.entity';
import type { SurveyQuestion } from '../modules/surveys/entities/survey-question.entity';
import type { SurveyResponse } from '../modules/surveys/entities/survey-response.entity';
import type { SurveyTarget } from '../modules/surveys/entities/survey-target.entity';
import type { User } from '../modules/users/entities/user.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Like seed.lifecycle.ts: must not import anything that reaches AppModule.

export interface EvaluationsSeedRepositories {
  userRepository: Repository<User>;
  userTenantRepository: Repository<UserTenant>;
  academicYearRepository: Repository<AcademicYear>;
  subjectRepository: Repository<Subject>;
  teacherRepository: Repository<Teacher>;
  studentRepository: Repository<Student>;
  noteRepository: Repository<StudentNote>;
  formVersionRepository: Repository<AcrFormVersion>;
  criterionRepository: Repository<AcrCriterion>;
  assessmentRepository: Repository<AcrAssessment>;
  scoreRepository: Repository<AcrScore>;
  incidentRepository: Repository<StaffIncident>;
  surveyRepository: Repository<Survey>;
  surveyQuestionRepository: Repository<SurveyQuestion>;
  surveyTargetRepository: Repository<SurveyTarget>;
  surveyResponseRepository: Repository<SurveyResponse>;
  surveyAnswerRepository: Repository<SurveyAnswer>;
}

type Block = 'BLOCK_2' | 'BLOCK_3';

/** The 25 reference criteria (blocks 2.1-2.13 and 3.1-3.12). */
export const ACR_DEFAULT_CRITERIA: readonly (readonly [Block, string, string, string])[] = [
  ['BLOCK_2', '2.1', 'Discipline', 'শৃঙ্খলা'],
  ['BLOCK_2', '2.2', 'Judgment and dimensionality', 'বিচারবুদ্ধি ও বহুমাত্রিকতা'],
  ['BLOCK_2', '2.3', 'Intelligence', 'বুদ্ধিমত্তা'],
  ['BLOCK_2', '2.4', 'Enthusiasm and initiative', 'উৎসাহ ও উদ্যোগ'],
  ['BLOCK_2', '2.5', 'Personality', 'ব্যক্তিত্ব'],
  ['BLOCK_2', '2.6', 'Collaboration', 'সহযোগিতা'],
  ['BLOCK_2', '2.7', 'Punctuality', 'সময়ানুবর্তিতা'],
  ['BLOCK_2', '2.8', 'Reliability/Credibility', 'নির্ভরযোগ্যতা ও বিশ্বাসযোগ্যতা'],
  ['BLOCK_2', '2.9', 'Sense of responsibility', 'দায়িত্ববোধ'],
  ['BLOCK_2', '2.10', 'Interest in work', 'কাজে আগ্রহ'],
  [
    'BLOCK_2',
    '2.11',
    'Activities in taking action and obeying orders',
    'পদক্ষেপ গ্রহণ ও আদেশ পালনে তৎপরতা',
  ],
  ['BLOCK_2', '2.12', 'Safety awareness', 'নিরাপত্তা সচেতনতা'],
  [
    'BLOCK_2',
    '2.13',
    'Behavior towards parents and the public',
    'অভিভাবক ও জনসাধারণের প্রতি আচরণ',
  ],
  ['BLOCK_3', '3.1', 'Professional subject based knowledge', 'বিষয়ভিত্তিক পেশাগত জ্ঞান'],
  ['BLOCK_3', '3.2', 'Interest in acquiring knowledge', 'জ্ঞান অর্জনে আগ্রহ'],
  ['BLOCK_3', '3.3', 'Skills in understanding content', 'বিষয়বস্তু বোঝার দক্ষতা'],
  ['BLOCK_3', '3.4', 'Ability to supervise and manage', 'তত্ত্বাবধান ও ব্যবস্থাপনার সক্ষমতা'],
  ['BLOCK_3', '3.5', 'Relationships with colleagues', 'সহকর্মীদের সাথে সম্পর্ক'],
  ['BLOCK_3', '3.6', 'Decision making skills', 'সিদ্ধান্ত গ্রহণের দক্ষতা'],
  ['BLOCK_3', '3.7', 'Ability to implement decisions', 'সিদ্ধান্ত বাস্তবায়নের সক্ষমতা'],
  ['BLOCK_3', '3.8', 'Interest and skills in training', 'প্রশিক্ষণে আগ্রহ ও দক্ষতা'],
  ['BLOCK_3', '3.9', 'Power of expression (Writing)', 'প্রকাশ ক্ষমতা (লিখিত)'],
  ['BLOCK_3', '3.10', 'Power of expression (Verbal)', 'প্রকাশ ক্ষমতা (মৌখিক)'],
  ['BLOCK_3', '3.11', 'Interest in administrative work', 'প্রশাসনিক কাজে আগ্রহ'],
  ['BLOCK_3', '3.12', 'Conscientiousness', 'কর্তব্যনিষ্ঠা'],
];

export const SEED_SURVEY_TITLE = 'Teacher feedback (demo)';
export const SEED_SURVEY_RESPONSES = 6;
const STAFF_EMAIL = 'accountant@biddaloy.test'; // role test user (ensureRoleTestUsers)
const TEACHER_EMAIL = 'teacher@biddaloy.test';

/** Deterministic score 1-4 for criterion index `i`. */
export const seedScore = (i: number) => 4 - (i % 3);

/**
 * [28.1.4] Demo rows for Epic 28: default 25-criteria form (v1), one
 * COMPLETED + one INCOMPLETE ACR, one OPEN survey with 6 responses (passes
 * min-N 5), two incidents, a rating on one existing student note.
 * Idempotent: every row is found by natural key first. Warns and skips when
 * the demo prerequisites are absent.
 */
export async function ensureEvaluationsSeed(
  repos: EvaluationsSeedRepositories,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  const year = await repos.academicYearRepository.findOne({
    where: { tenant_id: tenantId, name: DEMO_ACADEMIC_YEAR.name },
  });
  const teacherUser = await repos.userRepository.findOne({ where: { email: TEACHER_EMAIL } });
  const staffUser = await repos.userRepository.findOne({ where: { email: STAFF_EMAIL } });
  const teacher = teacherUser
    ? await repos.teacherRepository.findOne({
        where: { tenant_id: tenantId, user_id: teacherUser.id },
      })
    : null;
  const subject = await repos.subjectRepository.findOne({
    where: { tenant_id: tenantId, code: 'MATH' },
  });
  if (!year || !teacherUser || !staffUser || !teacher || !subject) {
    console.warn('Demo year/teacher/staff/subject not found - skipping evaluations seed.');
    return;
  }

  // --- ACR form v1 + criteria ---------------------------------------------
  let form = await repos.formVersionRepository.findOne({
    where: { tenant_id: tenantId, version: 1 },
  });
  if (!form) {
    form = await repos.formVersionRepository.save(
      repos.formVersionRepository.create({
        tenant_id: tenantId,
        version: 1,
        created_by: adminUserId,
      }),
    );
  }
  const criteria: AcrCriterion[] = [];
  for (const [i, [block, code, en, bn]] of ACR_DEFAULT_CRITERIA.entries()) {
    let c = await repos.criterionRepository.findOne({
      where: { tenant_id: tenantId, form_version_id: form.id, code },
    });
    if (!c) {
      c = await repos.criterionRepository.save(
        repos.criterionRepository.create({
          tenant_id: tenantId,
          form_version_id: form.id,
          block,
          code,
          label_en: en,
          label_bn: bn,
          sort_order: i,
        }),
      );
    }
    criteria.push(c);
  }

  // --- ACRs: teacher COMPLETED (all 25 scored), accounts officer INCOMPLETE
  const ensureAssessment = async (userId: string, status: 'COMPLETED' | 'INCOMPLETE') => {
    const existing = await repos.assessmentRepository.findOne({
      where: { tenant_id: tenantId, user_id: userId, academic_year_id: year.id },
    });
    if (existing) return;
    const scored = status === 'COMPLETED' ? criteria : criteria.slice(0, 5);
    const total = scored.reduce((sum, _c, i) => sum + seedScore(i), 0);
    const a = await repos.assessmentRepository.save(
      repos.assessmentRepository.create({
        tenant_id: tenantId,
        user_id: userId,
        academic_year_id: year.id,
        form_version_id: form.id,
        status,
        total: status === 'COMPLETED' ? total : null,
        assessed_by: adminUserId,
        step1_data: null,
        step3_data: null,
        completed_at: status === 'COMPLETED' ? new Date() : null,
      }),
    );
    for (const [i, c] of scored.entries()) {
      await repos.scoreRepository.save(
        repos.scoreRepository.create({
          tenant_id: tenantId,
          assessment_id: a.id,
          criterion_id: c.id,
          score: seedScore(i),
        }),
      );
    }
  };
  await ensureAssessment(teacherUser.id, 'COMPLETED');
  await ensureAssessment(staffUser.id, 'INCOMPLETE');

  // --- incidents ------------------------------------------------------------
  const incidents = [
    ['COMMENDATION', 'LOW', 'Organised the annual science fair.', '2026-03-12'],
    ['ABSENCE', 'MEDIUM', 'Unannounced absence on exam day.', '2026-05-04'],
  ] as const;
  for (const [type, severity, body, occurred_on] of incidents) {
    const existing = await repos.incidentRepository.findOne({
      where: { tenant_id: tenantId, staff_user_id: teacherUser.id, type, occurred_on },
    });
    if (!existing) {
      await repos.incidentRepository.save(
        repos.incidentRepository.create({
          tenant_id: tenantId,
          staff_user_id: teacherUser.id,
          type,
          severity,
          body,
          occurred_on,
          reported_by: adminUserId,
        }),
      );
    }
  }

  // --- survey: OPEN, one target, one question, 6 responses -------------------
  let survey = await repos.surveyRepository.findOne({
    where: { tenant_id: tenantId, title: SEED_SURVEY_TITLE },
  });
  if (!survey) {
    survey = await repos.surveyRepository.save(
      repos.surveyRepository.create({
        tenant_id: tenantId,
        title: SEED_SURVEY_TITLE,
        status: 'OPEN',
        anonymous: true,
        respondent: 'STUDENTS',
        opens_at: new Date(),
        closes_at: null,
        min_responses: 5,
      }),
    );
  }
  let question = await repos.surveyQuestionRepository.findOne({
    where: { tenant_id: tenantId, survey_id: survey.id, sort_order: 0 },
  });
  if (!question) {
    question = await repos.surveyQuestionRepository.save(
      repos.surveyQuestionRepository.create({
        tenant_id: tenantId,
        survey_id: survey.id,
        sort_order: 0,
        text: 'How clearly does this teacher explain the subject?',
        stars_enabled: true,
      }),
    );
  }
  const target = await repos.surveyTargetRepository.findOne({
    where: { survey_id: survey.id, teacher_id: teacher.id, subject_id: subject.id },
  });
  if (!target) {
    await repos.surveyTargetRepository.save(
      repos.surveyTargetRepository.create({
        tenant_id: tenantId,
        survey_id: survey.id,
        teacher_id: teacher.id,
        subject_id: subject.id,
      }),
    );
  }
  for (let n = 1; n <= SEED_SURVEY_RESPONSES; n += 1) {
    const email = `survey.respondent${n}@demoschool.example`;
    let respondent = await repos.userRepository.findOne({ where: { email }, withDeleted: true });
    if (!respondent) {
      respondent = await repos.userRepository.save(
        repos.userRepository.create({
          email,
          full_name: `Survey Respondent ${n}`,
          password_hash: 'not-a-real-hash-demo-seed-only',
          status: UserStatus.ACTIVE,
        }),
      );
    }
    const membership = await repos.userTenantRepository.findOne({
      where: { user_id: respondent.id, tenant_id: tenantId, role: UserRole.STUDENT },
    });
    if (!membership) {
      await repos.userTenantRepository.save(
        repos.userTenantRepository.create({
          user_id: respondent.id,
          tenant_id: tenantId,
          role: UserRole.STUDENT,
        }),
      );
    }
    const existing = await repos.surveyResponseRepository.findOne({
      where: {
        survey_id: survey.id,
        respondent_user_id: respondent.id,
        teacher_id: teacher.id,
        subject_id: subject.id,
      },
    });
    if (existing) continue;
    const response = await repos.surveyResponseRepository.save(
      repos.surveyResponseRepository.create({
        tenant_id: tenantId,
        survey_id: survey.id,
        respondent_user_id: respondent.id,
        teacher_id: teacher.id,
        subject_id: subject.id,
      }),
    );
    await repos.surveyAnswerRepository.save(
      repos.surveyAnswerRepository.create({
        tenant_id: tenantId,
        response_id: response.id,
        question_id: question.id,
        text: null,
        stars: 3 + (n % 3),
      }),
    );
  }

  // --- a rating on a demo student note (rows come from ensureStudentLifecycleSeed)
  const student = await repos.studentRepository.findOne({
    where: { tenant_id: tenantId, registration_number: `${DEMO_ACADEMIC_YEAR.name}-0004` },
  });
  const note = student
    ? await repos.noteRepository.findOne({
        where: { tenant_id: tenantId, student_id: student.id },
      })
    : null;
  if (note && note.rating == null) {
    note.rating = 4;
    await repos.noteRepository.save(note);
  }
}
