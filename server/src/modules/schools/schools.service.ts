import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import Redis from 'ioredis';
import type { TenantSettings } from '@biddaloy/shared';
import { AuditAction, CommunicationStatus, UserStatus } from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings, toPlainSettingsPatch } from './settings/tenant-settings-merge.util';
import { EncryptionService } from './settings/encryption.service';
import { decryptSecretFields, encryptSecretFields } from './settings/settings-encryption.util';
import { maskSecretFields } from './settings/settings-mask.util';
import { pickPatchShape, redactSecretPaths } from './settings/settings-audit-redact.util';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { TENANT_STATUS_REDIS } from './tenant-status.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

export interface SchoolStats {
  active_users: number;
  students: number;
  communications_queued: number;
  communications_failed_7d: number;
  last_activity_at: Date | null;
}

const STATS_CACHE_TTL_SECONDS = 60;
const STATS_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(CommunicationLog)
    private readonly communicationLogRepo: Repository<CommunicationLog>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    private readonly encryption: EncryptionService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly auditService: AuditService,
  ) {}

  async findById(id: string): Promise<School> {
    const school = await this.repo.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(`School with ID "${id}" not found`);
    }
    return school;
  }

  /**
   * Every school's id and name, for #8.7.13's super-admin school picker —
   * a super admin configuring settings needs to pick *which* school
   * before anything else, and there's no other way to enumerate schools
   * today. Deliberately just `{ id, name }`: this is a picker, not a
   * schools-admin list view, so it doesn't need slug/domain/address/etc.
   * Controller-gated to `SUPER_ADMIN` only — an ADMIN already knows their
   * one school from `tenant.id`, no picker involved.
   */
  async findAll(): Promise<Pick<School, 'id' | 'name'>[]> {
    return this.repo.find({ select: ['id', 'name'], order: { name: 'ASC' } });
  }

  /**
   * Resolved settings with secret fields still in their stored,
   * *encrypted* form. Internal building block for `getMaskedSettings`
   * (the HTTP-safe view) and `getDecryptedSettings` (the trusted-internal
   * plaintext view) — not safe to return from a controller directly,
   * since an encrypted envelope string is not the same thing as "safe to
   * show," just "not immediately readable."
   */
  async getResolvedSettings(schoolId: string): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    return resolveTenantSettings(school.settings);
  }

  /** Shared `onError` for every `maskSecretFields` call site below — one
   * undecryptable field degrades to `{ configured: true }` with no hint
   * rather than failing the whole response; this just logs which
   * school/field needs attention when that happens. */
  private logMaskingFailure(schoolId: string) {
    return (error: unknown, path: string) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Reporting "${path}" as configured with no hint for school "${schoolId}": ${reason}`,
      );
    };
  }

  /**
   * Resolved settings with every secret field replaced by a
   * `{ configured, hint }` object — see `settings-mask.util.ts`'s own
   * comment for exactly what that means for a set/cleared/never-set
   * field. This is what `SchoolsController`'s `GET`/`PATCH` responses
   * actually return; the plaintext never leaves the process to compute
   * it.
   */
  async getMaskedSettings(schoolId: string): Promise<Record<string, unknown>> {
    const resolved = await this.getResolvedSettings(schoolId);
    return maskSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      this.logMaskingFailure(schoolId),
    );
  }

  /**
   * Same as `getResolvedSettings`, with every secret field decrypted to
   * plaintext. For trusted internal callers only — #8.7.10's per-tenant
   * provider resolver is the intended (and, on this branch, only) one.
   * **Never** wire this to an HTTP response; #8.7.9's settings API must
   * mask secrets, not decrypt them.
   *
   * A field that can't be decrypted (a stale key, or a legacy plaintext
   * row `yarn settings:reencrypt` — `server/src/scripts/
   * reencrypt-settings.ts` — hasn't reached yet) is dropped from the
   * result and logged with the school and path, rather than failing the
   * whole call: one bad WhatsApp token shouldn't also take down a
   * school's working SMS or SMTP settings.
   */
  async getDecryptedSettings(schoolId: string): Promise<TenantSettings> {
    const resolved = await this.getResolvedSettings(schoolId);
    return decryptSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      (error, path) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Dropping undecryptable tenant setting "${path}" for school "${schoolId}": ${reason}`,
        );
      },
    ) as unknown as TenantSettings;
  }

  /**
   * Merges a validated patch into the school's stored settings and
   * persists it. `dto` is expected to have already passed class-validator
   * (either through Nest's global `ValidationPipe`, once #8.7.9 wires a
   * controller, or a direct `validate()` call) — this method does not
   * re-validate, it merges and saves.
   *
   * Secret fields in `dto` (plaintext, as the caller wrote them) are
   * encrypted *before* merging — encrypting the merged result instead
   * would re-encrypt already-encrypted fields carried over unchanged from
   * what was already stored, corrupting them.
   *
   * Writes a `SETTINGS_CHANGE` audit entry in the same transaction as the
   * save (#8.7.11) — a failed audit write must roll back the settings
   * change with it, not leave an untracked mutation. The diff is scoped to
   * exactly the paths `dto` touches (`pickPatchShape`, the nested
   * equivalent of `FeeStructureService.update`'s `changedKeys`) and every
   * `@Secret()`-marked field in it is replaced with a fixed marker
   * (`redactSecretPaths`) *before* it reaches `AuditService.record` — never
   * the plaintext the caller sent, and never the encrypted envelope either,
   * since a ciphertext string is still a credential's stored form.
   *
   * Invalidates `TenantSettingsCache` for this school after the transaction
   * commits — #8.7.10's per-tenant provider resolver reads through that
   * same cache (shared via `SchoolsModule`'s export, not a second
   * instance), so a school that just rotated a WhatsApp token would
   * otherwise keep sending under the old one until the cache's own TTL
   * happened to expire.
   *
   * Returns the masked settings computed from the row this call itself
   * just saved, rather than the caller doing a second `getMaskedSettings`
   * read afterward — that would be a third query per PATCH, and a window
   * (how ever short) in which the response could reflect a write that
   * landed between this transaction committing and that re-read running,
   * rather than the caller's own.
   */
  async updateSettings(
    schoolId: string,
    dto: TenantSettingsDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Record<string, unknown>> {
    const plainPatch = toPlainSettingsPatch(dto);
    const encryptedPatch = encryptSecretFields(plainPatch, this.encryption);

    const settings = await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) {
        throw new NotFoundException(`School with ID "${schoolId}" not found`);
      }

      const oldSnapshot = pickPatchShape(
        (school.settings ?? {}) as Record<string, unknown>,
        plainPatch,
      );

      school.settings = mergeTenantSettings(school.settings, encryptedPatch);
      await schoolRepo.save(school);

      await this.auditService.record(
        {
          action: AuditAction.SETTINGS_CHANGE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: redactSecretPaths(oldSnapshot),
          new_values: redactSecretPaths(plainPatch),
        },
        manager,
      );

      return school.settings;
    });

    this.settingsCache.invalidate(schoolId);
    const resolved = resolveTenantSettings(settings);
    return maskSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      this.logMaskingFailure(schoolId),
    );
  }

  private statsKey(schoolId: string): string {
    return `tenant:${schoolId}:stats`;
  }

  /**
   * Five cheap platform metrics for the SUPER_ADMIN console detail page
   * (#532). Every query below filters by this school's `tenant_id` — no
   * cross-tenant joins, matching the rest of this module's per-query
   * scoping (see the `multi-tenancy` skill checklist).
   *
   * Cached in Redis for 60s, keyed by school id, reusing the same
   * fail-open-friendly client `TenantStatusService` (#527) already wires
   * up as `TENANT_STATUS_REDIS` — a cache read/write failure here degrades
   * to "compute it," never to an error.
   */
  async getStats(schoolId: string): Promise<SchoolStats> {
    const key = this.statsKey(schoolId);

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SchoolStats;
        return {
          ...parsed,
          last_activity_at: parsed.last_activity_at ? new Date(parsed.last_activity_at) : null,
        };
      }
    } catch (error) {
      this.logger.error(
        `Stats cache read failed for school ${schoolId}, falling back to DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const failedSince = new Date(Date.now() - STATS_FAILED_WINDOW_MS);

    const [activeUsers, students, communicationsQueued, communicationsFailed7d, lastActivity] =
      await Promise.all([
        this.userTenantRepo
          .createQueryBuilder('ut')
          .innerJoin('ut.user', 'user')
          .where('ut.tenant_id = :schoolId', { schoolId })
          .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
          .getCount(),
        this.studentRepo.count({ where: { tenant_id: schoolId } }),
        this.communicationLogRepo.count({
          where: { tenant_id: schoolId, status: CommunicationStatus.QUEUED },
        }),
        this.communicationLogRepo.count({
          where: {
            tenant_id: schoolId,
            status: CommunicationStatus.FAILED,
            created_at: MoreThanOrEqual(failedSince),
          },
        }),
        this.auditLogRepo
          .createQueryBuilder('al')
          .select('MAX(al.created_at)', 'max_created_at')
          .where('al.tenant_id = :schoolId', { schoolId })
          .getRawOne<{ max_created_at: Date | null }>(),
      ]);

    const stats: SchoolStats = {
      active_users: activeUsers,
      students,
      communications_queued: communicationsQueued,
      communications_failed_7d: communicationsFailed7d,
      last_activity_at: lastActivity?.max_created_at ?? null,
    };

    try {
      await this.redis.set(key, JSON.stringify(stats), 'EX', STATS_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        `Stats cache write failed for school ${schoolId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return stats;
  }
}
