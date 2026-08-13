import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TenantSettings } from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings, toPlainSettingsPatch } from './settings/tenant-settings-merge.util';
import { EncryptionService } from './settings/encryption.service';
import { decryptSecretFields, encryptSecretFields } from './settings/settings-encryption.util';
import { maskSecretFields } from './settings/settings-mask.util';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    private readonly encryption: EncryptionService,
    private readonly settingsCache: TenantSettingsCache,
  ) {}

  async findById(id: string): Promise<School> {
    const school = await this.repo.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(`School with ID "${id}" not found`);
    }
    return school;
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
   * Invalidates `TenantSettingsCache` for this school after saving —
   * #8.7.10's per-tenant provider resolver reads through that same cache
   * (shared via `SchoolsModule`'s export, not a second instance), so a
   * school that just rotated a WhatsApp token would otherwise keep
   * sending under the old one until the cache's own TTL happened to
   * expire.
   */
  async updateSettings(schoolId: string, dto: TenantSettingsDto): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    const encryptedPatch = encryptSecretFields(toPlainSettingsPatch(dto), this.encryption);
    school.settings = mergeTenantSettings(school.settings, encryptedPatch);
    await this.repo.save(school);
    this.settingsCache.invalidate(schoolId);
    return resolveTenantSettings(school.settings);
  }
}
