import { Injectable } from '@nestjs/common';
import type { ApprovalMode, OrganisationSettings, RoutineSettings } from '@biddaloy/shared';
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

  /** [33.2.1] The tenant's `settings.organisation` — shift/version/group
   * vocabulary, defaulting to empty arrays when unset (see
   * `DEFAULT_ORGANISATION_SETTINGS`). `ClassService`/`SectionService`
   * validate writes against this instead of a hardcoded enum. */
  async organisationVocabulary(tenantId: string): Promise<OrganisationSettings> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    // Always present on a resolved `TenantSettings` — same invariant as
    // `feesApprovalMode` above (the resolver fills it from
    // `DEFAULT_ORGANISATION_SETTINGS`).
    return settings.organisation!;
  }

  /** [21.3.1] The tenant's `settings.routine` — scheduling constraints
   * (changeover minutes, per-teacher/day caps), defaulting via
   * `DEFAULT_ROUTINE_SETTINGS` when unset. `PeriodSlotsService`'s
   * changeover-suggestion endpoint (D7) reads this instead of a hardcoded
   * constant. */
  async routineSettings(tenantId: string): Promise<RoutineSettings> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    // Always present on a resolved `TenantSettings` — same invariant as
    // `feesApprovalMode`/`organisationVocabulary` above.
    return settings.routine!;
  }
}
