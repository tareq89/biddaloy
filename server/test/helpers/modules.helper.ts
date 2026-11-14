import type { INestApplication } from '@nestjs/common';
import type { SchoolLabels, SchoolModules } from '@biddaloy/shared';
import { SchoolsService } from '../../src/modules/schools/schools.service';
import { TenantSettingsDto } from '../../src/modules/schools/dto/tenant-settings.dto';
import { SEED_ADMIN_USER_ID } from '../constants';

/**
 * [Epic 77] Turn modules on or off for a test tenant, through the real service so the
 * settings cache is invalidated and the audit rows are written. `null` for a key removes it.
 * `userId` defaults to the seeded admin (the audit row needs a real user).
 */
export async function setModules(
  app: INestApplication,
  tenantId: string,
  modules: { [K in keyof SchoolModules]: SchoolModules[K] | null },
  userId: string = SEED_ADMIN_USER_ID,
): Promise<void> {
  const dto = Object.assign(new TenantSettingsDto(), { modules });
  await app.get(SchoolsService).updateSettings(tenantId, dto, userId);
}

/** Same for renamed words. `null` for a key removes it. */
export async function setLabels(
  app: INestApplication,
  tenantId: string,
  labels: { [K in keyof SchoolLabels]: SchoolLabels[K] | null },
  userId: string = SEED_ADMIN_USER_ID,
): Promise<void> {
  const dto = Object.assign(new TenantSettingsDto(), { labels });
  await app.get(SchoolsService).updateSettings(tenantId, dto, userId);
}
