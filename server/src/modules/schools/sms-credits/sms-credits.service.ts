import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { AuditAction } from '@biddaloy/shared';
import { SmsCreditService, CreditBalance } from '../../communications/credits/sms-credit.service';
import { AuditService } from '../../audit/audit.service';
import { GrantSmsCreditsDto } from './dto/grant-sms-credits.dto';

/**
 * [15.6.7/#550] Thin platform-facing wrapper around `SmsCreditService`:
 * routes a signed `units` delta to `grant`/`adjust`, then writes the
 * audit row the SUPER_ADMIN console needs. `SmsCreditService` remains the
 * only writer to the ledger/balance tables — this never touches them
 * directly. `forwardRef` on both sides breaks the same
 * `SchoolsModule` <-> `CreditsModule` cycle `CreditsModule`'s own file
 * comment documents.
 */
@Injectable()
export class SmsCreditsService {
  constructor(
    @Inject(forwardRef(() => SmsCreditService))
    private readonly smsCreditService: SmsCreditService,
    private readonly auditService: AuditService,
  ) {}

  async grantOrAdjust(
    schoolId: string,
    dto: GrantSmsCreditsDto,
    actorUserId: string,
  ): Promise<CreditBalance> {
    const opts = { reason: dto.reason, actorUserId, idempotencyKey: dto.idempotency_key };

    const balance =
      dto.units > 0
        ? await this.smsCreditService.grant(schoolId, dto.units, opts)
        : await this.smsCreditService.adjust(schoolId, dto.units, opts);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'School',
      entity_id: schoolId,
      tenant_id: schoolId,
      performed_by_user_id: actorUserId,
      ip_address: null,
      user_agent: null,
      old_values: null,
      new_values: { units: dto.units, reason: dto.reason },
    });

    return balance;
  }
}
