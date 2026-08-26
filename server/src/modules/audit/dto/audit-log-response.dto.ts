import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '@biddaloy/shared';
import { AuditLog } from '../entities/audit-log.entity';

/**
 * The public shape of an AuditLog row. The `tenant` relation is never
 * joined, so it is omitted here — only the `tenant_id` column it resolves
 * to is ever populated on the entity this is built from.
 *
 * `performed_by` is the one exception: [8.11.10]'s audit-trail screen
 * needs a human name in its "Who" column, so `findAll` left-joins the
 * relation and selects exactly `full_name` off it, surfaced below as the
 * flat `performed_by_name`. `findByEntity` does not join it, so that
 * route's rows carry `null` there — its own caller (a student's Activity
 * tab) shows no "Who" column.
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

  /** The acting user's `full_name`, or `null` when the action was
   * system-triggered (no `performed_by_user_id` at all), the user row has
   * since been deleted (`onDelete: 'SET NULL'`), or the query that built
   * this row never joined the relation. A client renders "System" for all
   * three — none of them has a name to show. */
  @ApiProperty({ nullable: true, type: String })
  performed_by_name: string | null;

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
    dto.performed_by_name = log.performed_by?.full_name ?? null;
    dto.old_values = log.old_values;
    dto.new_values = log.new_values;
    dto.ip_address = log.ip_address;
    dto.user_agent = log.user_agent;
    dto.created_at = log.created_at;
    return dto;
  }
}

/** `findAll` returns `{ ...result, data: [...] }`, not a bare array —
 * this is what its `@ApiResponse` actually documents. */
export class AuditLogListResponseDto {
  @ApiProperty({ type: AuditLogResponseDto, isArray: true })
  data: AuditLogResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
