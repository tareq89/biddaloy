import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditAction,
  ImpersonationEndedBy,
  SUPPORT_ACCESS_TEXT_VERSION,
  SupportAccessMode,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { School } from '../../schools/entities/school.entity';
import {
  readSupportAccess,
  withSupportAccess,
} from '../../schools/settings/support-access-settings';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { User } from '../../users/entities/user.entity';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import type { RequestContext } from '../../../common/request-context.util';
import type { SupportAccessSettingsResponseDto } from './dto/support-access-settings.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

/**
 * [99.3.02] Read, confirm and change a school's support access mode (D3, D16, D24). Clones
 * SchoolsService.updateSettings's shape (row lock, merge, audit, cache drop) because the generic
 * PATCH refuses the `supportAccess` key.
 */
@Injectable()
export class SupportAccessSettingsService {
  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly cache: TenantSettingsCache,
    private readonly sessions: ImpersonationSessionService,
    private readonly notices: SupportAccessNoticeService,
  ) {}

  async get(schoolId: string): Promise<SupportAccessSettingsResponseDto> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');
    const s = readSupportAccess(school.settings as Record<string, unknown> | null);
    const by = s.confirmedBy
      ? await this.users.findOne({ where: { id: s.confirmedBy }, select: ['id', 'full_name'] })
      : null;
    return {
      mode: s.mode,
      confirmedAt: s.confirmedAt,
      confirmedByName: by?.full_name ?? null,
      textVersion: s.textVersion,
      currentTextVersion: SUPPORT_ACCESS_TEXT_VERSION,
      needsConfirmation: s.confirmedAt === null || s.textVersion < SUPPORT_ACCESS_TEXT_VERSION,
    };
  }

  /** The first-login box: ticked is `allowed`, unticked `blocked`. Same state again is a no-op. */
  async confirm(
    schoolId: string,
    userId: string,
    dto: { allowed: boolean; textVersion: number },
    ctx: RequestContext = NO_CONTEXT,
  ): Promise<SupportAccessSettingsResponseDto> {
    if (dto.textVersion !== SUPPORT_ACCESS_TEXT_VERSION) {
      throw new ConflictException({
        message: 'The consent text has changed. Reload and read it again.',
        details: { code: 'TEXT_VERSION_STALE' },
      });
    }
    const mode = dto.allowed ? SupportAccessMode.ALLOWED : SupportAccessMode.BLOCKED;
    await this.write(schoolId, userId, ctx, mode, true);
    return this.get(schoolId);
  }

  async changeMode(
    schoolId: string,
    userId: string,
    mode: SupportAccessMode,
    ctx: RequestContext = NO_CONTEXT,
  ): Promise<SupportAccessSettingsResponseDto> {
    await this.write(schoolId, userId, ctx, mode, false);
    return this.get(schoolId);
  }

  private async write(
    schoolId: string,
    userId: string,
    ctx: RequestContext,
    mode: SupportAccessMode,
    confirming: boolean,
  ): Promise<void> {
    const oldMode = await this.schools.manager.transaction(async (manager) => {
      const repo = manager.getRepository(School);
      const school = await repo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) throw new NotFoundException('School not found');
      const old = readSupportAccess(school.settings as Record<string, unknown> | null);
      const confirmed = old.confirmedAt !== null && old.textVersion === SUPPORT_ACCESS_TEXT_VERSION;
      // Nothing to write: same mode, and (for confirm) already confirmed at this text version.
      if (old.mode === mode && (!confirming || confirmed)) return null;

      const next = confirming
        ? {
            mode,
            confirmedAt: new Date().toISOString(),
            confirmedBy: userId,
            textVersion: SUPPORT_ACCESS_TEXT_VERSION,
          }
        : { ...old, mode };
      school.settings = withSupportAccess(school.settings as Record<string, unknown> | null, next);
      await repo.save(school);
      await this.audit.record(
        {
          action: AuditAction.SUPPORT_ACCESS_MODE_CHANGED,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: ctx.ip,
          user_agent: ctx.userAgent,
          old_values: { mode: old.mode },
          new_values: { mode },
        },
        manager,
      );
      return old.mode;
    });
    // Blocked always revokes (idempotent): if a previous revoke failed after commit, a retry of the
    // same PUT must still end the live sessions rather than no-op.
    if (oldMode === null) {
      if (mode === SupportAccessMode.BLOCKED) {
        await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.MODE_BLOCKED);
      }
      return;
    }

    this.cache.invalidate(schoolId);
    if (oldMode !== mode) await this.afterModeChange(schoolId, userId, mode);
    else if (mode === SupportAccessMode.BLOCKED) {
      await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.MODE_BLOCKED);
    }
  }

  private async afterModeChange(
    schoolId: string,
    userId: string,
    mode: SupportAccessMode,
  ): Promise<void> {
    if (mode === SupportAccessMode.BLOCKED) {
      await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.MODE_BLOCKED);
    }
    const actor = await this.users.findOne({ where: { id: userId }, select: ['id', 'full_name'] });
    await this.notices.modeChanged(schoolId, {
      person: actor?.full_name ?? 'An administrator',
      mode: mode === SupportAccessMode.BLOCKED ? 'off' : mode,
      time: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      changedByUserId: userId,
    });
  }
}
