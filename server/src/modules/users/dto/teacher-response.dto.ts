import { ApiProperty } from '@nestjs/swagger';
import { TeacherDesignation } from '@biddaloy/shared';
import { Teacher } from '../../academics/entities/teacher.entity';
import { UserResponseDto } from './user-response.dto';

/**
 * The public shape of a Teacher — `user` narrowed to `UserResponseDto` so a
 * `password_hash` loaded via the `user` relation never reaches a response.
 * Build one with `TeacherResponseDto.fromEntity`, not `new` directly. Omits
 * `tenant`: the service queries never join it, so it's never actually
 * populated on the entity this is built from — only `tenant_id` is.
 */
export class TeacherResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty()
  employee_id: string;

  @ApiProperty({ enum: TeacherDesignation, isArray: true })
  designations: TeacherDesignation[];

  @ApiProperty({ nullable: true, type: String })
  subject_specialization: string | null;

  @ApiProperty({ nullable: true, type: Date })
  joining_date: Date | null;

  @ApiProperty()
  tenant_id: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  deleted_at: Date | null;

  static fromEntity(teacher: Teacher): TeacherResponseDto {
    const dto = new TeacherResponseDto();
    dto.id = teacher.id;
    dto.user = UserResponseDto.fromEntity(teacher.user);
    dto.employee_id = teacher.employee_id;
    dto.designations = teacher.designations;
    dto.subject_specialization = teacher.subject_specialization;
    dto.joining_date = teacher.joining_date;
    dto.tenant_id = teacher.tenant_id;
    dto.created_at = teacher.created_at;
    dto.updated_at = teacher.updated_at;
    dto.deleted_at = teacher.deleted_at;
    return dto;
  }
}

/** `findAllTeachers` returns `{ ...result, data: [...] }`, not a bare array
 * — this is what its `@ApiResponse` actually documents. */
export class TeacherListResponseDto {
  @ApiProperty({ type: TeacherResponseDto, isArray: true })
  data: TeacherResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
