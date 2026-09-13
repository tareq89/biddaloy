import { Injectable } from '@nestjs/common';
import type { ApprovalMode } from '@biddaloy/shared';
import { SchoolsService } from '../schools.service';

/**
 * Narrow, read-only entry point onto a tenant's resolved settings for
 * callers that only need one field and shouldn't have to know the whole
 * `TenantSettings` shape (or reach into `SchoolsService` directly) to get
 * it — [16.2.1]'s `settings.fees.approvalMode` is the first of these,
 * consumed by 16.2.2's step-up approval flow to decide whether PASSWORD is
 * an allowed verification method alongside OTP.
 *
 * Delegates to `SchoolsService.getResolvedSettings`, which already goes
 * through `TenantSettingsCache` — this adds no caching of its own.
 */
@Injectable()
export class SchoolSettingsReader {
  constructor(private readonly schoolsService: SchoolsService) {}

  /** The tenant's `settings.fees.approvalMode`, defaulting to `'OTP'` when
   * unset or invalid (see `resolveTenantSettings`'s read-side guard). */
  async feesApprovalMode(tenantId: string): Promise<ApprovalMode> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    // `fees` is always present on a resolved `TenantSettings` (the resolver
    // fills it from `DEFAULT_FEES_SETTINGS`), so this non-null assertion
    // reflects that invariant rather than papering over an unknown case.
    return settings.fees!.approvalMode;
  }
}
