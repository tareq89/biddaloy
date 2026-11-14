import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { scriptedAddress, scriptedPhoneNumber, type Script } from './script';

export type School = components['schemas']['School'];

const PLAN_ID = '00000000-0000-4000-8000-000000000001';

export function schoolFactory(overrides: Partial<School> = {}, script?: Script): School {
  const name = faker.company.name();
  return {
    id: faker.string.uuid(),
    name,
    slug: faker.helpers.slugify(name).toLowerCase(),
    address: scriptedAddress(script),
    phone: scriptedPhoneNumber(script),
    email: faker.internet.email(),
    name_bn: null,
    registration_id: null,
    logo_key: null,
    settings: null,
    status: 'ACTIVE',
    status_reason: null,
    status_changed_at: null,
    country_code: null,
    trial_ends_at: null,
    plan_id: PLAN_ID,
    plan: {
      id: PLAN_ID,
      name: 'Standard',
      unit_price_paisa: 1000,
      active: true,
      is_default: true,
      created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    },
    seat_limit: null,
    onboarding: null,
    created_in_demo: false,
    is_platform: false,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
