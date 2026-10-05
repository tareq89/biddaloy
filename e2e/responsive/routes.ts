import type { APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createAcr,
  createClassSection,
  createExamTemplate,
  createGuardian,
  createInvoice,
  createInvoiceShareToken,
  createReminderBatch,
  createStaffUser,
  createStudentWithDues,
  createSurvey,
  createTeacher,
  createTeacherForSection,
  currentAcademicYearId,
  findSchoolIdBySlug,
  get,
  post,
  superAdminApiSession,
  type ApiSession,
} from '../api';
import { acrBody, surveyBody } from '../fixtures/evaluations';
import { test } from '../fixtures/test';
import manifest from '../route-manifest.json';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';

/** Shared manifest typing + param resolution for the responsive suites
 * (same resolution strategy as the a11y suite). */

export interface ManifestRoute {
  path: string;
  role: string;
  archetype: string;
  params?: Record<string, string>;
  overlays?: string[];
}

export const routes = (manifest as { routes: ManifestRoute[] }).routes;

// One admin login per worker process, not one per dynamic route resolved —
// every call in this file needs the same ADMIN session, and re-logging in
// for each of the manifest's several dynamic routes was pointless load on
// the auth endpoint.
let sharedSessionPromise: Promise<ApiSession> | null = null;

function sharedAdminSession(request: APIRequestContext): Promise<ApiSession> {
  sharedSessionPromise ??= adminApiSession(request);
  return sharedSessionPromise;
}

export async function resolvePath(
  request: APIRequestContext,
  route: ManifestRoute,
): Promise<string> {
  if (!route.path.includes('$')) return route.path;
  if (route.path.includes('$schoolId')) {
    // SUPER_ADMIN platform console (#535) — `GET /schools` is SUPER_ADMIN
    // only, so this can't ride the shared ADMIN session. Resolves the
    // seeded second school the same way `provision-and-suspend.spec.ts`
    // does, rather than provisioning a fresh one per viewport/theme run.
    const superAdmin = await superAdminApiSession(request);
    const schoolId = await findSchoolIdBySlug(request, superAdmin, 'rose-valley-school');
    return route.path.replace('$schoolId', schoolId);
  }
  if (route.path.startsWith('/my-class/')) {
    // [47.4.4] The page is a 404 for any section the caller is not a class
    // teacher of, so a fresh admin-made section would not do: use the seeded
    // class teacher's own first section.
    const password = process.env[SEED_PASSWORD_ENV];
    if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
    const login = await request.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS.teacher, password },
    });
    if (!login.ok()) throw new Error(`teacher login failed: ${login.status()}`);
    const body = (await login.json()) as {
      access_token: string;
      memberships: { tenantId: string; role: string }[];
    };
    const tenantId = body.memberships.find((m) => m.role === 'TEACHER')?.tenantId;
    if (!tenantId) throw new Error('no TEACHER membership for seed teacher');
    const sections = await request.get('/api/v1/my-class/sections', {
      headers: { Authorization: `Bearer ${body.access_token}`, 'X-Tenant-ID': tenantId },
    });
    if (!sections.ok()) throw new Error(`GET /my-class/sections failed: ${sections.status()}`);
    const first = ((await sections.json()) as { section_id: string }[])[0];
    if (!first) throw new Error('seed teacher has no homeroom section');
    return route.path.replace('$sectionId', first.section_id);
  }
  const session: ApiSession = await sharedAdminSession(request);
  const stamp = Date.now();
  if (route.path.startsWith('/exams/templates/')) {
    // [35.5.3] Must precede the print-template branch below: an exam-template
    // detail needs an EXAM template id, not a print-template one.
    const template = await createExamTemplate(request, session, `Reflow Exam Template ${stamp}`);
    return route.path.replace('$templateId', template.id);
  }
  if (route.path.includes('$templateId')) {
    // [32.4.1] The full-screen template editor needs a real template to open.
    const template = await post<{ id: string }>(request, session, '/print-templates', {
      name: `Reflow Template ${stamp}`,
      suggestion_key: 'student-portrait-classic',
    });
    return route.path.replace('$templateId', template.id);
  }
  if (route.path.includes('$studentId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Student ${stamp}`);
    return route.path.replace('$studentId', studentId);
  }
  if (route.path.includes('$guardianId')) {
    const guardian = await createGuardian(request, session, `Reflow Guardian ${stamp}`);
    return route.path.replace('$guardianId', guardian.id);
  }
  if (route.path.includes('$assessmentId')) {
    // [28.3.7] `/staff/$userId/acr/$assessmentId` 404s without a real ACR: start
    // one (INCOMPLETE, on the latest form) for a fresh teacher. Admin is the
    // assessor, not the subject, so the subject-404 rule does not apply.
    const teacher = await createTeacher(request, session, `Reflow ACR ${stamp}`);
    const yearId = await currentAcademicYearId(request, session);
    const acr = await createAcr(request, session, acrBody(teacher.userId, yearId));
    return route.path.replace('$userId', teacher.userId).replace('$assessmentId', acr.id);
  }
  if (route.path.includes('$surveyId')) {
    // [28.4] `/staff/evaluations/surveys/$surveyId` 404s without a real survey:
    // a DRAFT whose target is a real (teacher, subject) assignment.
    const chain = await createClassSection(request, session);
    const teacher = await createTeacherForSection(
      request,
      session,
      `Reflow Survey Teacher ${stamp}`,
      chain.sectionId,
    );
    const subject = await post<{ id: string }>(request, session, '/subjects', {
      code: `RF-${stamp.toString(36).toUpperCase()}`,
      name_en: 'Reflow Survey Subject',
    });
    await post(request, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
      teacher_id: teacher.teacherId,
      subject_id: subject.id,
    });
    const survey = await createSurvey(
      request,
      session,
      surveyBody(`Reflow survey ${stamp}`, teacher.teacherId, subject.id),
    );
    return route.path.replace('$surveyId', survey.id);
  }
  if (route.path.includes('$userId')) {
    const staffUser = await createStaffUser(request, session, `Reflow Staff ${stamp}`);
    return route.path.replace('$userId', staffUser.id);
  }
  if (route.path.includes('$batchId')) {
    const batch = await createReminderBatch(request, session, `Reflow Batch ${stamp}`);
    return route.path.replace('$batchId', batch.id);
  }
  if (route.path.includes('$invoiceId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Invoicee ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    return route.path.replace('$invoiceId', invoice.id);
  }
  if (route.path.includes('$token')) {
    // [16.5.3] `/i/$token` — the unauthenticated public receipt route.
    const { studentId } = await createStudentWithDues(request, session, `Reflow Receipt ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    const token = await createInvoiceShareToken(request, session, invoice.id);
    return route.path.replace('$token', token);
  }
  if (route.path.includes('$academicYearId') || route.path.includes('$classId')) {
    const chain = await createClassSection(request, session);
    return route.path
      .replace('$academicYearId', chain.academicYearId)
      .replace('$classId', chain.classId);
  }
  if (route.path.includes('$sectionId')) {
    // [9.6] No mapped teacher for this section — the admin session used
    // throughout this file has `ATTENDANCE_READ`, so the register still
    // renders (just with an empty/unmarked roster), which is all the
    // responsive-layout check below needs.
    const chain = await createClassSection(request, session);
    const path = route.path.replace('$sectionId', chain.sectionId);
    // [21.8.1] `/routines/$sectionId` also needs `?classId=` — the route
    // has no other way to find the section's class (see `$sectionId.tsx`'s
    // own doc comment) and renders `noClassIdExplanation` without it. The
    // manifest itself can't carry query params, so it's added here instead.
    return path.startsWith('/routines/') ? `${path}?classId=${chain.classId}` : path;
  }
  if (route.path.startsWith('/admission/')) {
    // Public, unauthenticated intake form of the seeded school.
    return route.path.replace('$slug', 'default-school');
  }
  if (route.path.includes('$setId')) {
    // Platform holiday sets come from an external fetch; render one only if
    // the seed (or an earlier run) already left one behind.
    const superAdmin = await superAdminApiSession(request);
    const sets = await get<{ id: string }[]>(request, superAdmin, '/platform/holiday-sets');
    if (!sets[0]) test.skip(true, 'no holiday set seeded: needs the external public-holiday fetch');
    return route.path.replace('$setId', sets[0]!.id);
  }
  if (route.path.includes('$scaleId')) {
    const scales = await get<{ id: string }[]>(request, session, '/grading/scales');
    return route.path.replace('$scaleId', scales[0]!.id);
  }
  if (route.path.includes('$programId')) {
    const programs = await get<{ id: string }[]>(request, session, '/programs');
    return route.path.replace('$programId', programs[0]!.id);
  }
  if (route.path.includes('$planId')) {
    const plans = await get<{ id: string }[]>(request, session, '/seat-plans');
    if (!plans[0]) test.skip(true, 'no seat plan seeded: building one needs a scheduled exam');
    return route.path.replace('$planId', plans[0]!.id);
  }
  if (route.path.includes('$runId')) {
    const runs = await get<{ id: string }[]>(request, session, '/promotions');
    if (!runs[0]) test.skip(true, 'no promotion run seeded: needs published exam results');
    return route.path.replace('$runId', runs[0]!.id);
  }
  if (route.path.includes('$examId')) {
    const chain = await createClassSection(request, session);
    const exam = await post<{ id: string }>(request, session, '/exams', {
      name: `Reflow Exam ${stamp}`,
      kind: 'TERM',
      academic_year_id: chain.academicYearId,
      class_id: chain.classId,
    });
    return route.path.replace('$examId', exam.id);
  }
  if (route.path.includes('$homeworkId')) {
    const chain = await createClassSection(request, session);
    const subject = await post<{ id: string }>(request, session, '/subjects', {
      code: `RH-${stamp.toString(36).toUpperCase()}`,
      name_en: 'Reflow Homework Subject',
    });
    const homework = await post<{ id: string }>(request, session, '/homework', {
      subject_id: subject.id,
      class_id: chain.classId,
      title: `Reflow Homework ${stamp}`,
      grading_mode: 'TICK',
    });
    return route.path.replace('$homeworkId', homework.id);
  }
  if (route.path.includes('$intakeId') || route.path.includes('$applicantId')) {
    const chain = await createClassSection(request, session);
    const intake = await post<{ id: string }>(request, session, '/admission-intakes', {
      title: `Reflow Intake ${stamp}`,
      class_section_id: chain.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: [],
    });
    if (route.path.includes('$intakeId')) return route.path.replace('$intakeId', intake.id);
    const response = await request.post('/api/v1/public/admission/default-school/applicants', {
      multipart: {
        intake_id: intake.id,
        applicant_name: `Reflow Applicant ${stamp}`,
        date_of_birth: '2018-06-01',
        gender: 'MALE',
        guardian_name: `Reflow Guardian ${stamp}`,
        guardian_phone: `1${3 + (stamp % 7)}${stamp.toString().slice(-8)}`,
      },
    });
    if (!response.ok()) throw new Error(`applicant submit failed: ${response.status()}`);
    const listed = await get<{ id: string }[] | { data: { id: string }[] }>(
      request,
      session,
      `/admission/applicants?intakeId=${intake.id}`,
    );
    const applicant = (Array.isArray(listed) ? listed : listed.data)[0]!;
    return route.path.replace('$applicantId', applicant.id);
  }
  if (route.path.startsWith('/payments/')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Payer ${stamp}`);
    const student = await get<{ full_name: string }>(request, session, `/students/${studentId}`);
    const dues = await get<{
      data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
    }>(request, session, `/fees/dues?search=${encodeURIComponent(student.full_name)}`);
    const due = dues.data.find((row) => row.student_id === studentId)!.dues[0]!;
    const result = await post<{ payment: { id: string } }>(request, session, '/payments/checkout', {
      idempotency_key: crypto.randomUUID(),
      lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
      payment_method: 'CASH',
    });
    return route.path.replace('$id', result.payment.id);
  }
  if (route.path.startsWith('/fees/schedules/')) {
    const chain = await createClassSection(request, session);
    const structure = await post<{ id: string }>(request, session, '/fee-structures', {
      fee_type: 'MONTHLY_TUITION',
      name: `Reflow Tuition ${stamp}`,
      amount: 500,
      class_id: chain.classId,
      academic_year_id: chain.academicYearId,
    });
    const schedule = await post<{ id: string }>(request, session, '/fees/schedules', {
      academic_year_id: chain.academicYearId,
      name: `Reflow Schedule ${stamp}`,
      audience: { class_id: chain.classId, enrollment_status: 'ACTIVE' },
      rule: { kind: 'MONTHLY', day_of_month: 5 },
      fee_structure_ids: [structure.id],
      starts_on: '2026-01-01',
    });
    return route.path.replace('$id', schedule.id);
  }
  throw new Error(`no resolver for ${route.path}`);
}
