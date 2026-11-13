import { BadRequestException, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { AuditAction, INSTITUTION_KINDS } from '@biddaloy/shared';
import type { InstitutionKind, ModuleKey } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import type { TenantSettingsDto } from '../schools/dto/tenant-settings.dto';
import type { RequestContext } from '../../common/request-context.util';
import type { InstitutionKindChangesDto } from './dto/apply-institution-kind.dto';

/** Fixed sentence (Rules 23/24): never echoes the submitted id. */
export const UNKNOWN_KIND = 'Unknown institution kind.';

/**
 * [77.4.1] Institution kinds (D23/D24). Apply overwrites ONLY the school's own module `on`
 * switches and word entries that the kind defines. It never sends `lock` or `offForRoles`
 * (deep merge keeps them), nor touches any data. Keys the kind does not define stay as they are.
 */
@Injectable()
export class InstitutionKindService {
  constructor(
    private readonly schools: SchoolsService,
    private readonly audit: AuditService,
  ) {}

  list(): InstitutionKind[] {
    return INSTITUTION_KINDS;
  }

  private find(id: string): InstitutionKind {
    const kind = INSTITUTION_KINDS.find((k) => k.id === id);
    if (!kind) throw new BadRequestException(UNKNOWN_KIND);
    return kind;
  }

  /** Read-only: no write, no audit row. */
  async preview(tenantId: string, id: string): Promise<InstitutionKindChangesDto> {
    return this.diff(tenantId, this.find(id));
  }

  async apply(
    tenantId: string,
    userId: string,
    id: string,
    context: RequestContext,
  ): Promise<InstitutionKindChangesDto> {
    const kind = this.find(id);
    const changes = await this.diff(tenantId, kind);
    // Idempotent: a second apply finds nothing to change, writes nothing, audits nothing.
    if (changes.modules.length === 0 && changes.labels.length === 0) return changes;

    const patch = {
      ...(changes.modules.length > 0 && {
        modules: Object.fromEntries(changes.modules.map((m) => [m.key, { on: m.to }])),
      }),
      ...(changes.labels.length > 0 && {
        labels: Object.fromEntries(changes.labels.map((l) => [l.key, l.to])),
      }),
    };
    // Writes + MODULES_UPDATED / WORDS_UPDATED audits happen in updateSettings' own transaction.
    await this.schools.updateSettings(
      tenantId,
      patch as unknown as TenantSettingsDto,
      userId,
      context,
    );
    // ponytail: outside that transaction (updateSettings takes no manager); a crash between
    // the two leaves the block audits but no kind row. Add a manager param if that matters.
    await this.audit.record({
      action: AuditAction.INSTITUTION_KIND_APPLIED,
      entity_type: 'School',
      entity_id: tenantId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      old_values: {
        modules: Object.fromEntries(changes.modules.map((m) => [m.key, { on: m.from }])),
        labels: Object.fromEntries(changes.labels.map((l) => [l.key, l.from])),
      },
      new_values: {
        kind: kind.id,
        modules: Object.fromEntries(changes.modules.map((m) => [m.key, { on: m.to }])),
        labels: Object.fromEntries(changes.labels.map((l) => [l.key, l.to])),
      },
    });
    return changes;
  }

  private async diff(tenantId: string, kind: InstitutionKind): Promise<InstitutionKindChangesDto> {
    const [modules, labels] = await Promise.all([
      this.schools.getSchoolModules(tenantId),
      this.schools.getSchoolLabels(tenantId),
    ]);
    return {
      modules: Object.entries(kind.modules)
        .map(([key, to]) => ({ key, from: modules[key as ModuleKey]?.on ?? true, to }))
        .filter((m) => m.from !== m.to),
      labels: Object.entries(kind.labels)
        .map(([key, to]) => ({
          key,
          from: (labels as Record<string, unknown>)[key] ?? null,
          to,
        }))
        .filter((l) => !isDeepStrictEqual(l.from, l.to)) as InstitutionKindChangesDto['labels'],
    };
  }
}
