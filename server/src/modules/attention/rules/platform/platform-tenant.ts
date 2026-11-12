import { Injectable } from '@nestjs/common';
import { TenantStatusService } from '../../../schools/tenant-status.service';

/** Active, unlocked `platform_admins` (D3b): who platform alerts and attention items go to. */
export { platformAdminRecipients as platformRecipients } from './platform-admin-recipients';

/** `school1, school2, school3 …` — at most three names (never any other school data). */
export const schoolNames = (names: string[]): string =>
  names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '');

/**
 * Which school is "the platform tenant" — platform alerts live there and
 * nowhere else. Delegates to `TenantStatusService.platformTenantId()` (the `is_platform` row).
 */
@Injectable()
export class PlatformTenantResolver {
  constructor(private readonly tenantStatus: TenantStatusService) {}

  resolve(): Promise<string | undefined> {
    return this.tenantStatus.platformTenantId();
  }
}
