import { ExamComponentKind, ExamComponentSource } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { examFactory } from './exam.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';
import { subjectFactory } from './subject.factory';

export type ExamComponent = components['schemas']['ExamComponent'];

export function examComponentFactory(overrides: Partial<ExamComponent> = {}): ExamComponent {
  const exam = overrides.exam ?? examFactory();
  const tenant = overrides.tenant ?? exam.tenant ?? schoolFactory();
  const subject = overrides.subject ?? subjectFactory({ tenant, tenant_id: tenant.id });
  return {
    id: faker.string.uuid(),
    tenant,
    tenant_id: tenant.id,
    exam,
    exam_id: exam.id,
    subject,
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
