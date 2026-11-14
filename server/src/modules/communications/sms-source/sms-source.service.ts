import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, CommunicationMedium } from '@biddaloy/shared';
import { RequestContext } from '../../../common/request-context.util';
import { AuditService } from '../../audit/audit.service';
import { School } from '../../schools/entities/school.entity';
import {
  descriptorsFor,
  isPlainObject,
  present,
  toNestedMedium,
} from '../../schools/settings/messaging-descriptors';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { readSmsSource, withSmsSource, type SmsSource } from './sms-source.util';

export interface SmsSourceState {
  source: SmsSource;
  /** A company block with all its required fields is saved. Never a value. */
  ownProviderSaved: boolean;
}

type Stored = Record<string, unknown> | null;

@Injectable()
export class SmsSourceService {
  constructor(
    @InjectRepository(School) private readonly repo: Repository<School>,
    private readonly audit: AuditService,
    private readonly settingsCache: TenantSettingsCache,
  ) {}

  private stateOf(settings: Stored): SmsSourceState {
    const comms = settings?.communications as Record<string, unknown> | undefined;
    const block = toNestedMedium(comms?.sms, CommunicationMedium.SMS);
    const ownProviderSaved = descriptorsFor(CommunicationMedium.SMS).some((d) => {
      const own = block?.[d.name];
      return isPlainObject(own) && d.fields.every((f) => !f.required || present(own[f.key]));
    });
    return { source: readSmsSource(settings), ownProviderSaved };
  }

  async get(schoolId: string): Promise<SmsSourceState> {
    const school = await this.repo.findOne({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');
    return this.stateOf(school.settings as Stored);
  }

  /** The only writer of `sms.source` (D9). Same value again: no write, no audit. */
  async set(
    schoolId: string,
    next: SmsSource,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SmsSourceState> {
    const { state, changed } = await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) throw new NotFoundException('School not found');
      const stored = school.settings as Stored;
      const old = readSmsSource(stored);
      if (old === next) return { state: this.stateOf(stored), changed: false };

      school.settings = withSmsSource(stored, next) as unknown as School['settings'];
      await schoolRepo.save(school);
      await this.audit.record(
        {
          action: AuditAction.SMS_SOURCE_CHANGED,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { source: old },
          new_values: { source: next },
        },
        manager,
      );
      return { state: this.stateOf(school.settings as Stored), changed: true };
    });
    if (changed) this.settingsCache.invalidate(schoolId);
    return state;
  }
}
