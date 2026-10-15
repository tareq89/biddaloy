import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '@biddaloy/shared';

/**
 * One row of the "Recent activity" widget: just what the sentence needs
 * ("<who> <did what> <record> · <when>, <n> fields changed"). Deliberately has no
 * `old_values`, `new_values`, `ip_address`, `user_agent` or `tenant_id`.
 */
export class RecentActivityItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: AuditAction })
  action: AuditAction;

  @ApiProperty({ example: 'Student' })
  entity_type: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Display name of the record, when it can be resolved; null otherwise.',
  })
  entity_label: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Acting user’s full name; null for system actions or a removed user.',
  })
  performed_by_name: string | null;

  @ApiProperty({ example: '2026-10-07T04:12:00.000Z', description: 'ISO 8601, UTC' })
  created_at: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Fields whose value changed (UPDATE rows only); null for every other action.',
  })
  changed_field_count: number | null;
}

export class RecentActivityDto {
  @ApiProperty({ type: RecentActivityItemDto, isArray: true })
  items: RecentActivityItemDto[];
}
