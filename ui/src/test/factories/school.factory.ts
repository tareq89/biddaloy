import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { scriptedAddress, scriptedPhoneNumber, type Script } from './script';

export type School = components['schemas']['School'];

export function schoolFactory(overrides: Partial<School> = {}, script?: Script): School {
  const name = faker.company.name();
  return {
    id: faker.string.uuid(),
    name,
    slug: faker.helpers.slugify(name).toLowerCase(),
    domain: null,
    address: scriptedAddress(script),
    phone: scriptedPhoneNumber(script),
    email: faker.internet.email(),
    settings: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
