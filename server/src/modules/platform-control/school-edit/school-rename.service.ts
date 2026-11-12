import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import type { RequestContext } from '../../auth/refresh-token.service';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { School } from '../../schools/entities/school.entity';
import type { SchoolRenameDto, SchoolRenameResponseDto } from './dto/school-rename.dto';

const FIELDS = ['name', 'name_bn'] as const;

/**
 * [Epic 99, D7] Owner renames a school. Only `name` and `name_bn` can change; slug and domain
 * never do. Same transaction + lock + changed-fields diff as `SchoolProfileService.updateProfile`.
 * No cache holds a school name (stats and tenant-status caches are keyed by id and carry none).
 */
@Injectable()
export class SchoolRenameService {
  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly audit: AuditService,
    private readonly home: PlatformHomeService,
  ) {}

  async rename(
    schoolId: string,
    dto: SchoolRenameDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<SchoolRenameResponseDto> {
    const homeId = await this.home.id();
    return this.schools.manager.transaction(async (m) => {
      const current = await m
        .getRepository(School)
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!current) throw new NotFoundException('School not found');
      if (current.id === homeId) {
        throw new ConflictException('The platform school cannot be renamed');
      }

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const next = dto[f];
        if (next === undefined || current[f] === next) continue;
        oldValues[f] = current[f];
        newValues[f] = next;
        (current[f] as unknown) = next;
      }
      if (Object.keys(newValues).length === 0) {
        return { name: current.name, name_bn: current.name_bn, changed: false };
      }

      const saved = await m.getRepository(School).save(current);
      await this.audit.recordApproved(
        {
          action: AuditAction.PLATFORM_SCHOOL_RENAMED,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: oldValues,
          new_values: { ...newValues, reason: dto.reason },
          approved_by_user_id: actorUserId,
          approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
        },
        m,
      );
      return { name: saved.name, name_bn: saved.name_bn, changed: true };
    });
  }
}
