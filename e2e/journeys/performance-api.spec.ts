import {
  adminApiSession,
  createClassSection,
  createTeacher,
  currentAcademicYearId,
  get,
  post,
} from '../api';
import { expect, test } from '../fixtures/test';

/**
 * [28.3.7] API-level proof of the three Epic 28 /performance endpoints
 * (student, class, staff). Permission matrices are covered by the server
 * e2e suites; this checks the wire shapes the client relies on.
 */
test.describe('performance API', () => {
  test('student, class and staff endpoints answer 200 with their blocks', async ({ request }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    // The chain's own year: the student is enrolled there, not in the seeded current one.
    const yearId = chain.academicYearId;
    const currentYearId = await currentAcademicYearId(request, session);
    const student = await post<{ id: string }>(request, session, '/students', {
      full_name: `Perf Student ${Date.now()}`,
      class_section_id: chain.sectionId,
    });
    const teacher = await createTeacher(request, session, `Perf Teacher ${Date.now()}`);

    const klass = await get<{ classId: string; homework: object }>(
      request,
      session,
      `/performance/classes/${chain.classId}?academicYearId=${yearId}`,
    );
    expect(klass.classId).toBe(chain.classId);
    expect(klass.homework).toBeTruthy();

    const studentPerf = await get<object>(
      request,
      session,
      `/performance/students/${student.id}?academicYearId=${yearId}`,
    );
    expect(studentPerf).toBeTruthy();

    const staff = await get<{ userId: string; acr: unknown[]; classes: unknown[] }>(
      request,
      session,
      `/performance/staff/${teacher.userId}?academicYearId=${currentYearId}`,
    );
    expect(staff.userId).toBe(teacher.userId);
    expect(Array.isArray(staff.acr)).toBe(true);
    expect(Array.isArray(staff.classes)).toBe(true);
  });

  test('academicYearId is required', async ({ request }) => {
    const session = await adminApiSession(request);
    const teacher = await createTeacher(request, session, `Perf Teacher ${Date.now()}`);
    const response = await request.get(`/api/v1/performance/staff/${teacher.userId}`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    });
    expect(response.status()).toBe(400);
  });
});
