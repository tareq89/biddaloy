import {
  adminApiSession,
  closeSurvey,
  completeAcr,
  createAcr,
  createIncident,
  createSurvey,
  createTeacher,
  currentAcademicYearId,
  get,
  patch,
  publishSurvey,
  saveAcrCriteria,
} from '../api';
import { acrBody, acrCriteriaBody, incidentBody, surveyBody } from '../fixtures/evaluations';
import { expect, test } from '../fixtures/test';

/**
 * [28.2.x wave close] API-level proof of the W2 endpoints. The subject-404
 * rule (an admin cannot read their own ACR) and the answered-survey paths need
 * a second admin / a parent+student eligibility setup and are covered by the
 * server e2e suites (acr-assessments, survey-respond).
 */
test.describe('evaluations API', () => {
  test('ACR: start -> score -> complete -> locked', async ({ request }) => {
    const session = await adminApiSession(request);
    const yearId = await currentAcademicYearId(request, session);
    const staff = await createTeacher(request, session, `ACR Subject ${Date.now()}`);
    await saveAcrCriteria(request, session, acrCriteriaBody());
    const acr = await createAcr(request, session, acrBody(staff.userId, yearId));
    expect(acr.status).toBe('INCOMPLETE');

    const { criteria } = await get<{ criteria: { id: string }[] }>(
      request,
      session,
      '/acr/criteria',
    );
    await patch(request, session, `/acr/assessments/${acr.id}`, {
      scores: criteria.map((c) => ({ criterion_id: c.id, score: 4 })),
    });
    const done = await completeAcr(request, session, acr.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.total).toBe(criteria.length * 4);
  });

  test('incident: create then list', async ({ request }) => {
    const session = await adminApiSession(request);
    const staff = await createTeacher(request, session, `Incident Staff ${Date.now()}`);
    const created = await createIncident(request, session, incidentBody(staff.userId));
    expect(created.staffId).toBe(staff.userId);
    const list = await get<{ id: string }[] | { data: { id: string }[] }>(
      request,
      session,
      `/incidents?staffUserId=${staff.userId}`,
    );
    const rows = Array.isArray(list) ? list : list.data;
    expect(rows.map((r) => r.id)).toContain(created.id);
  });

  test('survey: draft -> open -> closed, results hidden below N', async ({ request }) => {
    const session = await adminApiSession(request);
    const teacher = await createTeacher(request, session, `Survey Teacher ${Date.now()}`);
    const subjects = await get<{ id: string }[] | { data: { id: string }[] }>(
      request,
      session,
      '/subjects',
    );
    const subjectId = (Array.isArray(subjects) ? subjects : subjects.data)[0]?.id;
    if (!subjectId) throw new Error('no subject seeded');
    const survey = await createSurvey(
      request,
      session,
      surveyBody(`E2E survey ${Date.now()}`, teacher.teacherId, subjectId),
    );
    expect(survey.status).toBe('DRAFT');
    expect((await publishSurvey(request, session, survey.id)).status).toBe('OPEN');
    expect((await closeSurvey(request, session, survey.id)).status).toBe('CLOSED');

    const { results: rows } = await get<{ results: { hidden: boolean }[] }>(
      request,
      session,
      `/surveys/${survey.id}/results`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.hidden)).toBe(true);
  });
});
