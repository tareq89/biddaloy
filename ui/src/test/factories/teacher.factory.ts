import { TeacherDesignation } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import type { Script } from './script';
import { userResponseFactory } from './user.factory';

export type Teacher = components['schemas']['TeacherResponseDto'];

export function teacherFactory(overrides: Partial<Teacher> = {}, script?: Script): Teacher {
  const user = overrides.user ?? userResponseFactory({}, { script });
  return {
    id: faker.string.uuid(),
    user,
    employee_id: `EMP-${faker.string.numeric(5)}`,
    designations: [TeacherDesignation.SUBJECT_TEACHER],
    subject_specialization: faker.helpers.arrayElement([
      'Mathematics',
      'Bangla',
      'English',
      'Science',
      'Social Studies',
    ]),
    joining_date: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    tenant_id: faker.string.uuid(),
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
