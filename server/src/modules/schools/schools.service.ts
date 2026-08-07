import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TenantSettings } from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings, toPlainSettingsPatch } from './settings/tenant-settings-merge.util';
import { EncryptionService } from './settings/encryption.service';
import { decryptSecretFields, encryptSecretFields } from './settings/settings-encryption.util';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    private readonly encryption: EncryptionService,
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
   * *encrypted* form. Safe to build an API response from once #8.7.9
   * replaces the envelope with a masked `{ configured, hint }` — never
   * decrypt this to serve one, that's what `getDecryptedSettings` is for.
   */
  async getResolvedSettings(schoolId: string): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    return resolveTenantSettings(school.settings);
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
   */
  async updateSettings(schoolId: string, dto: TenantSettingsDto): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    const encryptedPatch = encryptSecretFields(toPlainSettingsPatch(dto), this.encryption);
    school.settings = mergeTenantSettings(school.settings, encryptedPatch);
    await this.repo.save(school);
    return resolveTenantSettings(school.settings);
  }
}
