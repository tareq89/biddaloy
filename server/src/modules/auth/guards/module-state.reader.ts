import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModuleKey, type PlatformModules, type SchoolModules } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { PlatformSetting } from '../../platform-identity/entities/platform-setting.entity';

/** The `platform_settings` key that holds the platform module map (D8). */
export const PLATFORM_MODULES_KEY = 'modules';
/** Same TTL as the tenant settings cache (D27). */
const PLATFORM_MODULES_TTL_MS = 30_000;
const KEYS = new Set<string>(Object.values(ModuleKey));

/**
 * [Epic 77] Inputs for `resolveModuleState` for one tenant. Errors propagate:
 * the guard never treats an unreadable state as "on" (D27).
 */
@Injectable()
export class ModuleStateReader {
  private platformCache: { value: PlatformModules; expiresAt: number } | null = null;
  // Bumped by invalidatePlatformModules(): a read already in flight must not store a map the
  // owner has just replaced (same trick as TenantSettingsCache).
  private platformGeneration = 0;

  constructor(
    private readonly schools: SchoolsService,
    private readonly dataSource: DataSource,
  ) {}

  async forTenant(tenantId: string): Promise<{ platform: PlatformModules; school: SchoolModules }> {
    return { platform: await this.platformModules(), school: await this.schoolModules(tenantId) };
  }

  /**
   * [77.6.01] The platform map, cached for 30 s per process. Invalidated here on the owner's own
   * write; a second app container only catches up when its TTL runs out (<= 30 s, accepted, D25).
   * A failed read throws and is not cached, so the request fails closed.
   */
  async platformModules(): Promise<PlatformModules> {
    if (this.platformCache && this.platformCache.expiresAt > Date.now()) {
      return this.platformCache.value;
    }
    const generation = this.platformGeneration;
    const row = await this.dataSource
      .getRepository(PlatformSetting)
      .findOne({ where: { key: PLATFORM_MODULES_KEY } });
    const value = sanitizePlatformModules(row?.value);
    if (generation === this.platformGeneration) {
      this.platformCache = { value, expiresAt: Date.now() + PLATFORM_MODULES_TTL_MS };
    }
    return value;
  }

  invalidatePlatformModules(): void {
    this.platformCache = null;
    this.platformGeneration += 1;
  }

  private schoolModules(tenantId: string): Promise<SchoolModules> {
    // no modules block means every module is on.
    return this.schools.getSchoolModules(tenantId);
  }
}

/** Keeps only known keys with boolean values; a missing row or odd shape reads as "all on". */
export function sanitizePlatformModules(raw: unknown): PlatformModules {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => KEYS.has(k) && typeof v === 'boolean'),
  );
}
