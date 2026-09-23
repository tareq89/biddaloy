import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RoutineChangeRequest } from './entities/routine-change-request.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { Routine } from './entities/routine.entity';
import { CreateChangeRequestDto, ResolveChangeRequestDto } from './dto/workflow.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { AuditAction, ChangeRequestState, RoutineState } from '@biddaloy/shared';

/**
 * D11: teachers flag a *published* slot for the builder's attention;
 * anyone holding `ROUTINE_MANAGE` (not only the routine's own author) may
 * accept or reject it. Accepting never auto-edits the routine — resolving
 * a request only records the decision, the actual grid edit (if any) is a
 * separate `PATCH .../slots/:slotId` through `RoutineSlotsService`,
 * because one accepted request often reshuffles other slots too.
 *
 * Requests stay open (and resolvable) across state transitions, including
 * after the routine cycles back through DRAFT/REVIEW/PUBLISHED again —
 * nothing about the state machine blocks opening or resolving one.
 */
@Injectable()
export class ChangeRequestsService {
  constructor(
    @InjectRepository(RoutineChangeRequest)
    private readonly requestRepo: Repository<RoutineChangeRequest>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    private readonly auditService: AuditService,
  ) {}

  async open(
    slotId: string,
    dto: CreateChangeRequestDto,
    tenantId: string,
    userId: string,
  ): Promise<RoutineChangeRequest> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId, tenant_id: tenantId } });
    if (!slot) {
      throw new NotFoundException(`Routine slot with ID "${slotId}" not found`);
    }
    const routine = await this.routineRepo.findOne({
      where: { id: slot.routine_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine || routine.state !== RoutineState.PUBLISHED) {
      throw new ConflictException('Change requests can only be raised against a published slot');
    }

    const entity = this.requestRepo.create({
      tenant_id: tenantId,
      routine_slot_id: slotId,
      requested_by: userId,
      note: dto.note,
      state: ChangeRequestState.OPEN,
    });
    return this.requestRepo.save(entity);
  }

  async findForRoutine(routineId: string, tenantId: string): Promise<RoutineChangeRequest[]> {
    const slots = await this.slotRepo.find({
      where: { routine_id: routineId, tenant_id: tenantId },
    });
    if (slots.length === 0) return [];
    return this.requestRepo
      .createQueryBuilder('cr')
      .where('cr.tenant_id = :tenantId', { tenantId })
      .andWhere('cr.routine_slot_id IN (:...slotIds)', { slotIds: slots.map((s) => s.id) })
      .orderBy('cr.created_at', 'DESC')
      .getMany();
  }

  async resolve(
    id: string,
    dto: ResolveChangeRequestDto,
    tenantId: string,
    userId: string,
    context: RequestContext,
  ): Promise<RoutineChangeRequest> {
    const request = await this.requestRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!request) {
      throw new NotFoundException(`Change request with ID "${id}" not found`);
    }
    if (request.state !== ChangeRequestState.OPEN) {
      throw new ConflictException(`Change request "${id}" is already resolved`);
    }

    request.state = dto.state;
    request.resolved_by = userId;
    request.resolved_at = new Date();
    request.resolution_note = dto.resolution_note ?? null;
    const saved = await this.requestRepo.save(request);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'RoutineChangeRequest',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      old_values: { state: ChangeRequestState.OPEN },
      new_values: { state: saved.state, resolution_note: saved.resolution_note },
    });

    return saved;
  }
}
