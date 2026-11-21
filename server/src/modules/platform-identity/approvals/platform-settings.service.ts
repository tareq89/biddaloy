import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { PlatformSetting } from '../entities/platform-setting.entity';

export const APPROVALS_ENABLED_KEY = 'approvals.enabled';
const DEFAULTS: Record<string, unknown> = { [APPROVALS_ENABLED_KEY]: true };

/** [Epic 98] Key/value platform settings. A missing row answers the key's default (D8: approvals on). */
@Injectable()
export class PlatformSettingsService {
  constructor(
    @InjectRepository(PlatformSetting) private readonly repo: Repository<PlatformSetting>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async get<T = unknown>(key: string, manager?: EntityManager): Promise<T> {
    const repo = manager ? manager.getRepository(PlatformSetting) : this.repo;
    const row = await repo.findOne({ where: { key } });
    return (row ? row.value : DEFAULTS[key]) as T;
  }

  /**
   * Read-merge-write under a Postgres advisory lock, so concurrent PUTs on any API instance
   * (app and app2 both serve the cockpit) never overwrite each other. Lock frees at commit.
   */
  async update<T>(key: string, fn: (old: T) => T, actorId: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`platform_settings:${key}`]);
      const old = await this.get<T>(key, m);
      const value = fn(old);
      await m
        .getRepository(PlatformSetting)
        .upsert({ key, value, updated_by: actorId } as never, ['key']);
      await this.audit.record({
        action: AuditAction.PLATFORM_SETTINGS_CHANGED,
        entity_type: 'PlatformAdmin',
        entity_id: actorId,
        tenant_id: null,
        performed_by_user_id: actorId,
        old_values: { key, value: old },
        new_values: { key, value },
      });
    });
  }

  async set(key: string, value: unknown, actorId: string): Promise<void> {
    const old = await this.get(key);
    await this.repo.upsert({ key, value, updated_by: actorId } as never, ['key']);
    await this.audit.record({
      action: AuditAction.PLATFORM_SETTINGS_CHANGED,
      entity_type: 'PlatformAdmin', // no PlatformSetting audit type exists in shared yet
      entity_id: actorId,
      tenant_id: null,
      performed_by_user_id: actorId,
      old_values: { key, value: old },
      new_values: { key, value },
    });
  }
}
