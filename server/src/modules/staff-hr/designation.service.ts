import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { Designation } from './entities/designation.entity';
import { AuditService } from '../audit/audit.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

/** CRUD for the tenant-editable designation (job title) list. 23.2.1. */
@Injectable()
export class DesignationService {
  constructor(
    @InjectRepository(Designation)
    private readonly repo: Repository<Designation>,
    private readonly auditService: AuditService,
  ) {}

  async findAll(tenantId: string): Promise<Designation[]> {
    return this.repo.find({ where: { tenant_id: tenantId }, order: { title_en: 'ASC' } });
  }

  async findOne(id: string, tenantId: string): Promise<Designation> {
    const designation = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!designation) throw new NotFoundException('Designation not found');
    return designation;
  }

  async create(
    dto: CreateDesignationDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<Designation> {
    const created = await this.repo.save(this.repo.create({ ...dto, tenant_id: tenantId }));
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'Designation',
      entity_id: created.id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      new_values: { ...dto },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateDesignationDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<Designation> {
    const existing = await this.findOne(id, tenantId);
    await this.repo.update({ id, tenant_id: tenantId }, dto);
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'Designation',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      old_values: { ...existing },
      new_values: { ...dto },
    });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string, actorUserId: string): Promise<void> {
    const existing = await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
    await this.auditService.record({
      action: AuditAction.DELETE,
      entity_type: 'Designation',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      old_values: { ...existing },
    });
  }
}
