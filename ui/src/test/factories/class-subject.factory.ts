import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { classFactory } from './class.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';
import { subjectFactory } from './subject.factory';

export type ClassSubject = components['schemas']['ClassSubject'];

export function classSubjectFactory(overrides: Partial<ClassSubject> = {}): ClassSubject {
  const klass = overrides.class ?? classFactory();
  const academicYear = overrides.academic_year ?? klass.academic_year ?? academicYearFactory();
  const tenant = overrides.tenant ?? klass.tenant ?? schoolFactory();
  const subject = overrides.subject ?? subjectFactory({ tenant, tenant_id: tenant.id });
  return {
    id: faker.string.uuid(),
    tenant,
    tenant_id: tenant.id,
    class: klass,
    class_id: klass.id,
    subject,
    subject_id: subject.id,
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    is_optional: false,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
