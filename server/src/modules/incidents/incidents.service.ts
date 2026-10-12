import { EventEmitter } from 'events';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AuditAction, EMPLOYEE_ROLES } from '@biddaloy/shared';
import { StaffIncident } from './entities/staff-incident.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { CreateIncidentDto, IncidentResponseDto, QueryIncidentsDto } from './dto/incident.dto';

/** Module-local emitter (same pattern as `feesEvents`). The payload carries
 * ids only — never incident text (D2 privacy). */
export const incidentEvents = new EventEmitter();
export const INCIDENT_CREATED = 'incident.created';
export interface IncidentCreatedEvent {
  incidentId: string;
  tenantId: string;
  staffUserId: string;
  reportedBy: string;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(StaffIncident) private readonly repo: Repository<StaffIncident>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateIncidentDto,
    tenantId: string,
    reporterId: string,
  ): Promise<IncidentResponseDto> {
    // The subject must be a staff member of this tenant (404 otherwise, same as cross-tenant).
    const member = await this.memberships.findOne({
      where: {
        user_id: dto.staffId,
        tenant_id: tenantId,
        role: In([...EMPLOYEE_ROLES]),
      },
    });
    if (!member) throw new NotFoundException('Staff member not found');

    const saved = await this.repo.save(
      this.repo.create({
        tenant_id: tenantId,
        staff_user_id: dto.staffId,
        type: dto.type,
        severity: dto.severity,
        body: dto.description,
        occurred_on: dto.occurredOn,
        reported_by: reporterId,
      }),
    );
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'StaffIncident',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: reporterId,
      old_values: null,
      new_values: {
        staff_user_id: saved.staff_user_id,
        type: saved.type,
        severity: saved.severity,
        occurred_on: saved.occurred_on,
      },
    });
    const event: IncidentCreatedEvent = {
      incidentId: saved.id,
      tenantId,
      staffUserId: saved.staff_user_id,
      reportedBy: reporterId,
    };
    incidentEvents.emit(INCIDENT_CREATED, event);
    return this.toResponse(saved);
  }

  /** Incidents about the caller are omitted (D2, D15). */
  async list(
    query: QueryIncidentsDto,
    tenantId: string,
    callerId: string,
  ): Promise<IncidentResponseDto[]> {
    const rows = await this.repo.find({
      where: {
        tenant_id: tenantId,
        withdrawn_at: IsNull(),
        staff_user_id: query.staffUserId ?? Not(callerId),
        ...(query.type ? { type: query.type } : {}),
      },
      order: { created_at: 'DESC' },
    });
    // A staffUserId filter equal to the caller must not bypass the omission.
    return rows.filter((r) => r.staff_user_id !== callerId).map((r) => this.toResponse(r));
  }

  async findOne(id: string, tenantId: string, callerId: string): Promise<IncidentResponseDto> {
    const row = await this.repo.findOne({
      where: { id, tenant_id: tenantId, withdrawn_at: IsNull() },
    });
    if (!row || row.staff_user_id === callerId) throw new NotFoundException('Incident not found');
    return this.toResponse(row);
  }

  /** GAP-11: withdraw (hide) an incident, with a reason. The row stays. */
  async withdraw(
    id: string,
    tenantId: string,
    callerId: string,
    reason: string,
  ): Promise<IncidentResponseDto> {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row || row.staff_user_id === callerId) throw new NotFoundException('Incident not found');
    if (row.withdrawn_at) {
      throw new ConflictException({
        code: 'INCIDENT_ALREADY_WITHDRAWN',
        message: 'Incident already withdrawn',
      });
    }
    // Conditional update: of two concurrent withdrawals only one wins.
    const withdrawnAt = new Date();
    const { affected } = await this.repo.update(
      { id, tenant_id: tenantId, withdrawn_at: IsNull() },
      { withdrawn_at: withdrawnAt, withdrawn_by_user_id: callerId, withdraw_reason: reason },
    );
    if (!affected) {
      throw new ConflictException({
        code: 'INCIDENT_ALREADY_WITHDRAWN',
        message: 'Incident already withdrawn',
      });
    }
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'StaffIncident',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: callerId,
      old_values: { withdrawn_at: null },
      new_values: { withdrawn_at: withdrawnAt.toISOString(), reason },
    });
    return this.toResponse({
      ...row,
      withdrawn_at: withdrawnAt,
      withdrawn_by_user_id: callerId,
      withdraw_reason: reason,
    });
  }

  private toResponse(r: StaffIncident): IncidentResponseDto {
    return {
      id: r.id,
      staffId: r.staff_user_id,
      type: r.type,
      severity: r.severity,
      occurredOn: r.occurred_on,
      description: r.body,
      createdAt: r.created_at.toISOString(),
      withdrawnAt: r.withdrawn_at ? r.withdrawn_at.toISOString() : null,
    };
  }
}
