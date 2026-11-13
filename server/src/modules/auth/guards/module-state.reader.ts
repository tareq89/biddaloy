import { Injectable } from '@nestjs/common';
import type { PlatformModules, SchoolModules } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';

/**
 * [Epic 77] Inputs for `resolveModuleState` for one tenant. Errors propagate:
 * the guard never treats an unreadable state as "on" (D27).
 */
@Injectable()
export class ModuleStateReader {
  constructor(private readonly schools: SchoolsService) {}

  async forTenant(tenantId: string): Promise<{ platform: PlatformModules; school: SchoolModules }> {
    return { platform: this.platformModules(), school: await this.schoolModules(tenantId) };
  }

  // replaced in 77.6.01
  private platformModules(): PlatformModules {
    return {};
  }

  private schoolModules(tenantId: string): Promise<SchoolModules> {
    // no modules block means every module is on.
    return this.schools.getSchoolModules(tenantId);
  }
}
