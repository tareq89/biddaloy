import { CommunicationMedium } from '@beton-boi/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';
import { scriptedAddress, scriptedFullName, scriptedPhoneNumber, type Script } from './script';
import { userFactory } from './user.factory';

export type Guardian = components['schemas']['Guardian'];

const RELATIONSHIPS = ['Father', 'Mother', 'Uncle', 'Aunt', 'Grandfather', 'Grandmother'] as const;

// Default `students: []` — `Student.guardians` points back at `Guardian`,
// and a factory-built `Guardian` never carries real `Student` objects by
// default, so the two never recurse into each other. Pass real students in
// via overrides when a test needs the link populated both ways.
export function guardianFactory(overrides: Partial<Guardian> = {}, script?: Script): Guardian {
  const tenant = overrides.tenant ?? schoolFactory();
  const user = overrides.user === undefined ? userFactory({}, { script }) : overrides.user;
  return {
    id: faker.string.uuid(),
    user,
    user_id: user?.id ?? null,
    full_name: scriptedFullName(script),
    relationship: faker.helpers.arrayElement(RELATIONSHIPS),
    phone: scriptedPhoneNumber(script),
    email: faker.internet.email(),
    alternate_phone: null,
    address: scriptedAddress(script),
    occupation: faker.person.jobTitle(),
    preferred_communication: CommunicationMedium.SMS,
    is_primary_contact: true,
    tenant,
    tenant_id: tenant.id,
    students: [],
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
