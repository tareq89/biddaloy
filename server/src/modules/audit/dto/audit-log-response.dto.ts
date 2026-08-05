import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '@beton-boi/shared';
import { AuditLog } from '../entities/audit-log.entity';

/**
 * The public shape of an AuditLog row. `findAll`'s query never joins the
 * `tenant`/`performed_by` relations, so those are omitted here too — only
 * the `*_id` columns they resolve to are ever actually populated on the
 * entity this is built from.
 */
export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: String })
  tenant_id: string | null;

  @ApiProperty({ enum: AuditAction })
  action: AuditAction;

  @ApiProperty()
  entity_type: string;

  @ApiProperty({ nullable: true, type: String })
  entity_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  performed_by_user_id: string | null;

  @ApiProperty({ nullable: true, type: Object })
  old_values: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: Object })
  new_values: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  ip_address: string | null;

  @ApiProperty({ nullable: true, type: String })
  user_agent: string | null;

  @ApiProperty()
  created_at: Date;

  static fromEntity(log: AuditLog): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = log.id;
    dto.tenant_id = log.tenant_id;
    dto.action = log.action;
    dto.entity_type = log.entity_type;
    dto.entity_id = log.entity_id;
    dto.performed_by_user_id = log.performed_by_user_id;
    dto.old_values = log.old_values;
    dto.new_values = log.new_values;
    dto.ip_address = log.ip_address;
    dto.user_agent = log.user_agent;
    dto.created_at = log.created_at;
    return dto;
  }
}
