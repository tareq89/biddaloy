import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { ApprovalScope, AuditAction, ModuleKey, type PlatformModules } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../../common/request-context.util';
import {
  PLATFORM_MODULES_KEY,
  ModuleStateReader,
  sanitizePlatformModules,
} from '../auth/guards/module-state.reader';
import { PlatformSetting } from '../platform-identity/entities/platform-setting.entity';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { attentionKeys } from '../attention/attention.constants';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';

/** Fixed sentences (Rule 23): never echo the submitted key or value. */
export const PLATFORM_MODULES_INVALID = {
  shape: 'modules must be an object of true or false per module',
  key: 'modules contains an unknown or core module',
  value: 'each module must be true or false',
  lockKey: 'Unknown module',
} as const;

export type SchoolModuleState = Record<string, { on?: boolean; lock?: 'on' | 'off' }>;

const KEYS = new Set<string>(Object.values(ModuleKey));
// ponytail: a global flip scans the whole keyspace once, capped; past this the 60 s TTL wins.
const MAX_SCAN_ROUNDS = 500;

/** Returns the fixed reason a platform map is invalid, or `null`. */
export function findPlatformModulesReason(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return PLATFORM_MODULES_INVALID.shape;
  }
  for (const [k, v] of Object.entries(value)) {
    if (!KEYS.has(k)) return PLATFORM_MODULES_INVALID.key;
    if (typeof v !== 'boolean') return PLATFORM_MODULES_INVALID.value;
  }
  return null;
}

/** [77.6.01] Owner-side module switches: the global map and the per-school lock (D3, D7, D8, D50). */
@Injectable()
export class PlatformModulesService {
  private readonly logger = new Logger(PlatformModulesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PlatformSetting) private readonly settings: Repository<PlatformSetting>,
    private readonly audit: AuditService,
    private readonly reader: ModuleStateReader,
    private readonly settingsCache: TenantSettingsCache,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  /** Read straight from the row (the owner screen must not show a 30 s old map). */
  async get(): Promise<{ modules: PlatformModules }> {
    const row = await this.settings.findOne({ where: { key: PLATFORM_MODULES_KEY } });
    return { modules: sanitizePlatformModules(row?.value) };
  }

  /**
   * One school's own module choices and locks, for the owner screen. Straight from the row (no
   * cache; a read failure fails the request, never an empty answer). Only `on` and `lock` of known
   * module keys leave here: `offForRoles` and anything unknown stay behind (Rule 31).
   */
  async getForSchool(schoolId: string): Promise<{ modules: SchoolModuleState }> {
    const rows: { modules: unknown }[] = await this.dataSource.query(
      `SELECT settings->'modules' AS modules FROM schools WHERE id = $1`,
      [schoolId],
    );
    if (rows.length === 0) throw new NotFoundException('School not found');
    const raw = rows[0].modules;
    const out: SchoolModuleState = {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { modules: out };
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!KEYS.has(k) || v === null || typeof v !== 'object') continue;
      const { on, lock } = v as { on?: unknown; lock?: unknown };
      const entry: SchoolModuleState[string] = {};
      if (typeof on === 'boolean') entry.on = on;
      if (lock === 'on' || lock === 'off') entry.lock = lock;
      if (Object.keys(entry).length) out[k] = entry;
    }
    return { modules: out };
  }

  /** Replaces the whole map. An absent key is on. Schools' own choices are never touched. */
  async replace(
    modules: unknown,
    actorId: string,
    context: RequestContext,
  ): Promise<{ modules: PlatformModules }> {
    const reason = findPlatformModulesReason(modules);
    if (reason) throw new BadRequestException(reason);
    const next = modules as PlatformModules;
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(PlatformSetting);
      // Serialise replacements: READ COMMITTED lets two runs read the same previous map
      // (also when the row is absent). Same pattern as year-rollover.service.ts.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PLATFORM_MODULES_KEY]);
      const old = await repo.findOne({ where: { key: PLATFORM_MODULES_KEY } });
      await repo.upsert({ key: PLATFORM_MODULES_KEY, value: next, updated_by: actorId } as never, [
        'key',
      ]);
      await this.audit.recordApproved(
        {
          action: AuditAction.PLATFORM_MODULES_UPDATED,
          entity_type: 'PlatformAdmin', // same convention as PlatformSettingsService
          entity_id: actorId,
          tenant_id: null,
          performed_by_user_id: actorId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { modules: sanitizePlatformModules(old?.value) },
          new_values: { modules: next },
          approved_by_user_id: actorId,
          approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
        },
        m,
      );
    });
    // After commit only. Other app containers catch up within the 30 s TTL.
    this.reader.invalidatePlatformModules();
    this.detachAttentionDrop('tenant:*:attention:summary:*');
    return { modules: next };
  }

  /** Sets (`on`/`off`) or clears (`null`) `schools.settings.modules.<key>.lock`, nothing else. */
  async setLock(
    schoolId: string,
    key: string,
    lock: 'on' | 'off' | null,
    actorId: string,
    context: RequestContext,
  ): Promise<{ key: string; lock: 'on' | 'off' | null }> {
    if (!KEYS.has(key)) throw new BadRequestException(PLATFORM_MODULES_INVALID.lockKey);
    await this.dataSource.transaction(async (m) => {
      // Row lock first: serialises against a school settings save and other lock writes.
      const rows: { lock: string | null }[] = await m.query(
        `SELECT settings #>> ARRAY['modules', $2, 'lock'] AS lock FROM schools WHERE id = $1 FOR UPDATE`,
        [schoolId, key],
      );
      if (rows.length === 0) throw new NotFoundException('School not found');
      const before = rows[0].lock;
      if (lock === null) {
        // Drop only the lock; an entry left empty goes with it.
        await m.query(
          `UPDATE schools SET settings = CASE
             WHEN (settings #> ARRAY['modules', $2]) - 'lock' = '{}'::jsonb
               THEN settings #- ARRAY['modules', $2]
             ELSE settings #- ARRAY['modules', $2, 'lock'] END
           WHERE id = $1 AND settings #> ARRAY['modules', $2, 'lock'] IS NOT NULL`,
          [schoolId, key],
        );
      } else {
        await m.query(
          `UPDATE schools SET settings = jsonb_set(
               jsonb_set(
                 jsonb_set(COALESCE(settings, '{}'::jsonb), '{modules}', COALESCE(settings->'modules', '{}'::jsonb)),
                 ARRAY['modules', $2], COALESCE(settings #> ARRAY['modules', $2], '{}'::jsonb)),
               ARRAY['modules', $2, 'lock'], to_jsonb($3::text))
           WHERE id = $1`,
          [schoolId, key, lock],
        );
      }
      if ((before ?? null) !== lock) {
        await this.audit.recordApproved(
          {
            action: AuditAction.PLATFORM_MODULE_LOCK_UPDATED,
            entity_type: 'School',
            entity_id: schoolId,
            tenant_id: schoolId,
            performed_by_user_id: actorId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { module: key, lock: before },
            new_values: { module: key, lock },
            approved_by_user_id: actorId,
            approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
          },
          m,
        );
      }
    });
    this.settingsCache.invalidate(schoolId);
    this.detachAttentionDrop(attentionKeys.summaryPattern(schoolId));
    return { key, lock };
  }

  /** Best effort and never awaited: Redis trouble only means the old <= 60 s lag. */
  private detachAttentionDrop(pattern: string): void {
    void (async () => {
      let cursor = '0';
      for (let i = 0; i < MAX_SCAN_ROUNDS; i += 1) {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        if (keys.length) await this.redis.del(...keys);
        cursor = next;
        if (cursor === '0') return;
      }
    })().catch((err: Error) => this.logger.warn(`attention summary drop failed: ${err.message}`));
  }
}
