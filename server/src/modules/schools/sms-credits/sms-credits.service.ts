import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { EntityManager } from 'typeorm';
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
    // `onApplied` runs inside the same DB transaction as the ledger/balance
    // write, only when this call actually applies a new movement (never on
    // an idempotency-key replay). `AuditService.record` fails open without
    // a transaction manager, so passing `manager` here makes the audit row
    // commit or roll back atomically with the credit movement it
    // describes — a retry that returns `applied: false` never needs to
    // repair a missing audit row, because there's no window where the
    // ledger commits without it.
    const opts = {
      reason: dto.reason,
      actorUserId,
      idempotencyKey: dto.idempotency_key,
      onApplied: async (manager: EntityManager) => {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'School',
            entity_id: schoolId,
            tenant_id: schoolId,
            performed_by_user_id: actorUserId,
            ip_address: null,
            user_agent: null,
            old_values: null,
            new_values: {
              units: dto.units,
              reason: dto.reason,
              idempotency_key: dto.idempotency_key,
            },
          },
          manager,
        );
      },
    };

    const { applied: _applied, ...balance } =
      dto.units > 0
        ? await this.smsCreditService.grant(schoolId, dto.units, opts)
        : await this.smsCreditService.adjust(schoolId, dto.units, opts);

    return balance;
  }
}
