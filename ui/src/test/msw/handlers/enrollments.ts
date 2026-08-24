import { http, HttpResponse } from 'msw';

import type { components } from '../../../api/schema';
import { classFactory, classSectionFactory, studentFactory } from '../../factories';
import { faker } from '../../factories/faker';

type Enrollment = components['schemas']['Enrollment'];

/**
 * No dedicated `enrollmentFactory` exists in `ui/src/test/factories` (the
 * entity was never given one in [8.3.x] — enrollments only ever showed up
 * as `Student.class_section`/`Student.enrollment_status`, never as their
 * own resource). Built inline here rather than adding one to the shared
 * factory library, which is out of this issue's scope.
 */
function enrollmentFactory(overrides: Partial<Enrollment> = {}): Enrollment {
  const student = overrides.student ?? studentFactory();
  const klass =
    overrides.class ?? classFactory({ academic_year: student.class_section.class.academic_year });
  const section =
    overrides.section === undefined ? classSectionFactory({ class: klass }) : overrides.section;
  return {
    id: faker.string.uuid(),
    student,
    student_id: student.id,
    class: klass,
    class_id: klass.id,
    section,
    section_id: section?.id ?? null,
    academic_year: klass.academic_year,
    academic_year_id: klass.academic_year.id,
    enrollment_status: 'ACTIVE',
    enrolled_at: new Date().toISOString(),
    tenant: student.tenant,
    tenant_id: student.tenant.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const create = http.post('/api/v1/enrollments', () =>
  HttpResponse.json(enrollmentFactory(), { status: 201 }),
);

const listByStudent = http.get('/api/v1/enrollments/student/:studentId', ({ params }) =>
  HttpResponse.json([
    enrollmentFactory({ student: studentFactory({ id: params.studentId as string }) }),
  ]),
);

const listByStudentEmpty = http.get('/api/v1/enrollments/student/:studentId', () =>
  HttpResponse.json([]),
);

const update = http.patch('/api/v1/enrollments/:id', ({ params }) =>
  HttpResponse.json(enrollmentFactory({ id: params.id as string })),
);

/** [8.11.3] — the "Move class" dialog's starting point. */
const current = http.get('/api/v1/enrollments/:studentId/current', ({ params }) =>
  HttpResponse.json(
    enrollmentFactory({ student: studentFactory({ id: params.studentId as string }) }),
  ),
);

/** [8.11.3] — the get-or-create fallback branch: a legacy student with no
 * ACTIVE `Enrollment` row yet. */
const currentEmpty = http.get('/api/v1/enrollments/:studentId/current', () =>
  HttpResponse.json(null),
);

export const enrollmentHandlers = {
  create,
  listByStudent,
  listByStudentEmpty,
  update,
  current,
  currentEmpty,
};

export const enrollmentDefaultHandlers = [create, listByStudent, update, current];
