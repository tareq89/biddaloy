import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  async get<T = unknown>(key: string): Promise<T> {
    const row = await this.repo.findOne({ where: { key } });
    return (row ? row.value : DEFAULTS[key]) as T;
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
