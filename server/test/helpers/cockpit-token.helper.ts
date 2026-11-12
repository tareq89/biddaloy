import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserStatus } from '@biddaloy/shared';
import { User } from '../../src/modules/users/entities/user.entity';
import { PlatformAdmin } from '../../src/modules/platform-identity/entities/platform-admin.entity';
import { CockpitSessionService } from '../../src/modules/auth/cockpit/cockpit-session.service';

/**
 * [Epic 98] A real platform owner (user + `platform_admins` row) with a live cockpit session,
 * for specs of platform-only routes. Skips the sign-in screens (those have their own specs).
 */
export async function mintCockpitToken(app: INestApplication, ds: DataSource): Promise<string> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const user = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      email: `cockpit-spec-${suffix}@biddaloy.test`,
      phone: `+88017${suffix.slice(-9).padStart(9, '0')}`,
      full_name: 'Cockpit spec owner',
      status: UserStatus.ACTIVE,
      email_verified_at: new Date(),
      phone_verified_at: new Date(),
    }),
  );
  await ds.getRepository(PlatformAdmin).insert({ user_id: user.id });
  const started = await app
    .get(CockpitSessionService)
    .start(user.id, { ip: '127.0.0.1', userAgent: 'vitest' });
  return started.accessToken;
}

/**
 * Removes the owners `mintCockpitToken` made. Call it in `afterAll`: a leftover `platform_admins`
 * row would make the next booted app in this worker's database run the platform cutover on it.
 */
export async function removeCockpitOwners(ds: DataSource): Promise<void> {
  await ds.query(
    `DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'cockpit-spec-%')`,
  );
}
