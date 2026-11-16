import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '@biddaloy/shared';

/** Roles a staff message may name. Guardians, students and platform owners are never staff. */
export const STAFF_AUDIENCE_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
] as const;

const ids = (description: string) =>
  ApiPropertyOptional({ type: [String], format: 'uuid', description });

/** [80.1.04] Who a staff message goes to: the union of every field given (D18). */
export class StaffAudienceDto {
  @ApiPropertyOptional({ enum: STAFF_AUDIENCE_ROLES, isArray: true })
  @IsOptional()
  @IsIn(STAFF_AUDIENCE_ROLES, { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  roles?: UserRole[];

  @ids('Staff whose current designation is one of these.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  designationIds?: string[];

  @ApiPropertyOptional({ description: 'true: teaching staff; false: non-teaching staff.' })
  @IsOptional()
  @IsBoolean()
  teaching?: boolean;

  @ids('Named people of this school.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  userIds?: string[];
}

// [80.1.05] extension point: PreviewStaffMessageDto / SendStaffMessageDto (text, medium,
// WhatsApp template fields) are added here by W1-05; this ticket owns the audience only.
