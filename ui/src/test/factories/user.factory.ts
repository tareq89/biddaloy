import { UserRole, UserStatus } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import type { Gender } from './bangla-data';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { scriptedFullName, scriptedPhoneNumber, type Script } from './script';

export type User = components['schemas']['User'];
export type UserResponseDto = components['schemas']['UserResponseDto'];

interface PersonOptions {
  script?: Script | undefined;
  gender?: Gender | undefined;
}

// Shared by both User shapes below — `User` (the full, embedded-relation
// shape guardians/students/payments/invoices carry a copy of) and
// `UserResponseDto` (the public shape the `/users` endpoints actually
// return) — because every field except `user_tenants`/`deleted_at` is
// identical between them.
function buildPersonFields({ script, gender }: PersonOptions) {
  const fullName = scriptedFullName(script, gender);
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    phone: scriptedPhoneNumber(script),
    status: UserStatus.ACTIVE,
    full_name: fullName,
    profile_picture_url: null,
    preferences: null,
    last_login_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
  };
}

export function userFactory(overrides: Partial<User> = {}, options: PersonOptions = {}): User {
  return {
    ...buildPersonFields(options),
    user_tenants: [],
    deleted_at: null,
    ...overrides,
  };
}

export function userResponseFactory(
  overrides: Partial<UserResponseDto> = {},
  options: PersonOptions = {},
): UserResponseDto {
  return {
    ...buildPersonFields(options),
    // Tenant-scoped membership role — [8.11.8]'s staff list/detail read
    // it for the Role column and the read-only ROLE_PERMISSIONS tab.
    role: UserRole.TEACHER,
    ...overrides,
  };
}
