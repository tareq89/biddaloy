import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { AuditAction, RoutineState } from '@biddaloy/shared';

/**
 * D11 state machine. Legal transitions:
 *
 * ```
 * DRAFT --submitForReview--> REVIEW
 * REVIEW --withdraw--> DRAFT
 * REVIEW --publish--> PUBLISHED
 * ```
 *
 * `PUBLISHED` has no entry in this table at all — there is no code path
 * that can move a routine out of `PUBLISHED`, ever (Acceptance: "No code
 * path leaves PUBLISHED"). This is enforced by the table itself, not by a
 * check somebody could forget to add at a new call site.
 */
const LEGAL_TRANSITIONS: Partial<Record<RoutineState, RoutineState[]>> = {
  [RoutineState.DRAFT]: [RoutineState.REVIEW],
  [RoutineState.REVIEW]: [RoutineState.DRAFT, RoutineState.PUBLISHED],
};

@Injectable()
export class RoutineStateService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    private readonly auditService: AuditService,
  ) {}

  async submitForReview(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<Routine> {
    return this.transition(id, tenantId, RoutineState.REVIEW, userId, context);
  }

  async withdraw(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<Routine> {
    return this.transition(id, tenantId, RoutineState.DRAFT, userId, context);
  }

  async publish(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<Routine> {
    return this.transition(id, tenantId, RoutineState.PUBLISHED, userId, context);
  }

  private async transition(
    id: string,
    tenantId: string,
    to: RoutineState,
    userId: string | null,
    context: RequestContext,
  ): Promise<Routine> {
    const routine = await this.routineRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine) {
      throw new NotFoundException(`Routine ID "${id}" not found`);
    }

    const allowed = LEGAL_TRANSITIONS[routine.state] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(`Cannot move routine from "${routine.state}" to "${to}"`);
    }

    const oldState = routine.state;
    // Atomic conditional update: only succeeds while the row is still in
    // `oldState`, so two concurrent transitions (e.g. publish vs.
    // withdraw, both starting from REVIEW) can't both win — the loser's
    // zero-row update surfaces as a conflict instead of silently
    // overwriting the winner's state.
    const result = await this.routineRepo.update(
      { id, tenant_id: tenantId, deleted_at: IsNull(), state: oldState },
      {
        state: to,
        published_at: to === RoutineState.PUBLISHED ? new Date() : routine.published_at,
      },
    );
    if (result.affected === 0) {
      throw new ConflictException(`Cannot move routine from "${oldState}" to "${to}"`);
    }
    const saved = await this.routineRepo.findOneOrFail({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'Routine',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      old_values: { state: oldState },
      new_values: { state: saved.state, published_at: saved.published_at },
    });

    return saved;
  }
}
