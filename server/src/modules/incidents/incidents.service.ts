import { EventEmitter } from 'events';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { EMPLOYEE_ROLES } from '@biddaloy/shared';
import { StaffIncident } from './entities/staff-incident.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
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
        staff_user_id: query.staffUserId ?? Not(callerId),
        ...(query.type ? { type: query.type } : {}),
      },
      order: { created_at: 'DESC' },
    });
    // A staffUserId filter equal to the caller must not bypass the omission.
    return rows.filter((r) => r.staff_user_id !== callerId).map((r) => this.toResponse(r));
  }

  async findOne(id: string, tenantId: string, callerId: string): Promise<IncidentResponseDto> {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row || row.staff_user_id === callerId) throw new NotFoundException('Incident not found');
    return this.toResponse(row);
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
    };
  }
}
