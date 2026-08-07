import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TenantSettings } from '@beton-boi/shared';
import { AuditAction } from '@beton-boi/shared';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings, toPlainSettingsPatch } from './settings/tenant-settings-merge.util';
import { EncryptionService } from './settings/encryption.service';
import { decryptSecretFields, encryptSecretFields } from './settings/settings-encryption.util';
import { maskSecretFields } from './settings/settings-mask.util';
import { pickPatchShape, redactSecretPaths } from './settings/settings-audit-redact.util';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
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
    return maskSecretFields(resolved as unknown as Record<string, unknown>, this.encryption);
  }

  /**
   * Same as `getResolvedSettings`, with every secret field decrypted to
   * plaintext. For trusted internal callers only — #8.7.10's per-tenant
   * provider resolver is the intended (and, on this branch, only) one.
   * **Never** wire this to an HTTP response; #8.7.9's settings API must
   * mask secrets, not decrypt them.
   */
  async getDecryptedSettings(schoolId: string): Promise<TenantSettings> {
    const resolved = await this.getResolvedSettings(schoolId);
    return decryptSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
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
   */
  async updateSettings(
    schoolId: string,
    dto: TenantSettingsDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<TenantSettings> {
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
    return resolveTenantSettings(settings);
  }
}
