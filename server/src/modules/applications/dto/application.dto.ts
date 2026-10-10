import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationSource,
  ApplicationStatus,
  ApplicationSubjectKind,
  ApplicationType,
  UserRole,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** One tag: a person (`user_id`) or a role (`role`), exactly one (D12, D14). */
export class ApplicationTagInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

/** `POST /applications` */
export class CreateApplicationDto {
  @ApiProperty({ enum: ApplicationType, enumName: 'ApplicationType' })
  @IsEnum(ApplicationType)
  type: ApplicationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subject_student_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subject_staff_profile_id?: string;

  /** Validated per type against `APPLICATION_PAYLOAD_DTOS`. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ApplicationAddressee, enumName: 'ApplicationAddressee' })
  @IsOptional()
  @IsEnum(ApplicationAddressee)
  addressee?: ApplicationAddressee;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  addressee_user_id?: string;

  /** Paper entry for an applicant who has an account (D8, D46). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  on_behalf_of_user_id?: string;

  /** Paper entry for a guardian with no login (D46). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @SanitizeText()
  applicant_name?: string;

  @ApiPropertyOptional({ type: [ApplicationTagInput] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApplicationTagInput)
  tags?: ApplicationTagInput[];
}

/** `POST /applications/letter-preview` (D48): the submit body without tags. */
export class LetterPreviewDto extends OmitType(CreateApplicationDto, ['tags'] as const) {}

/** `POST /applications/:id/comments` */
export class CommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @SanitizeText()
  note: string;
}

/** `POST /applications/:id/tags` */
export class AddTagsDto {
  @ApiProperty({ type: [ApplicationTagInput] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApplicationTagInput)
  tags: ApplicationTagInput[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ApplicationCanDto {
  @ApiProperty() decide: boolean;
  @ApiProperty() consider: boolean;
  @ApiProperty() withdraw: boolean;
  @ApiProperty() cancel: boolean;
  @ApiProperty() comment: boolean;
}

/** One list row; `ApplicationDto` extends it (A21). */
export class ApplicationListItemDto {
  @ApiProperty() id: string;
  /** `2026/0045`, Latin digits (D47). */
  @ApiProperty() serial: string;
  @ApiProperty() serial_year: number;
  @ApiProperty() serial_no: number;
  @ApiProperty({ enum: ApplicationType, enumName: 'ApplicationType' }) type: ApplicationType;
  @ApiProperty({ enum: ApplicationStatus, enumName: 'ApplicationStatus' })
  status: ApplicationStatus;
  @ApiProperty({ enum: ApplicationSource, enumName: 'ApplicationSource' })
  source: ApplicationSource;
  @ApiProperty({ nullable: true, type: String }) academic_year_id: string | null;
  @ApiProperty({ nullable: true, type: String }) applicant_user_id: string | null;
  @ApiProperty() applicant_name: string;
  @ApiProperty({ nullable: true, enum: UserRole, enumName: 'UserRole' })
  applicant_role: UserRole | null;
  @ApiProperty({ nullable: true, type: String }) entered_by_user_id: string | null;
  @ApiProperty({ nullable: true, type: String }) entered_by_name: string | null;
  @ApiProperty({ enum: ApplicationSubjectKind, enumName: 'ApplicationSubjectKind' })
  subject_kind: ApplicationSubjectKind;
  @ApiProperty({ nullable: true, type: String }) subject_student_id: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_staff_profile_id: string | null;
  @ApiProperty() subject_name: string;
  @ApiProperty({ nullable: true, type: String }) subject_class_name: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_section_name: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_roll: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_designation: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) payload: Record<string, unknown>;
  /** Display names for ids in the payload (`to_section_id`, `class_section_id`, `exam_id`, `subject_id`). */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  ref_names: Record<string, string>;
  @ApiProperty({ nullable: true, type: String }) start_date: string | null;
  @ApiProperty({ nullable: true, type: String }) end_date: string | null;
  @ApiProperty({ nullable: true, enum: ApplicationAddressee, enumName: 'ApplicationAddressee' })
  addressee: ApplicationAddressee | null;
  @ApiProperty({ nullable: true, type: String }) addressee_user_id: string | null;
  @ApiProperty({ nullable: true, type: String }) addressee_name: string | null;
  @ApiProperty() current_step: number;
  @ApiProperty() step_count: number;
  @ApiProperty({ nullable: true, type: String }) decided_by_user_id: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_at: string | null;
  @ApiProperty() created_at: string;
  @ApiProperty({ type: ApplicationCanDto }) can: ApplicationCanDto;
}

export class ApplicationEventDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ApplicationEventKind, enumName: 'ApplicationEventKind' })
  kind: ApplicationEventKind;
  @ApiProperty({ nullable: true, type: Number }) step: number | null;
  @ApiProperty() actor_user_id: string;
  @ApiProperty() actor_name: string;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  data: Record<string, unknown> | null;
  @ApiProperty() created_at: string;
}

export class ApplicationTagDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true, type: String }) user_id: string | null;
  @ApiProperty({ nullable: true, type: String }) user_name: string | null;
  @ApiProperty({ nullable: true, enum: UserRole, enumName: 'UserRole' }) role: UserRole | null;
}

export class ApplicationAttachmentDto {
  @ApiProperty() id: string;
  @ApiProperty() file_name: string;
  @ApiProperty() mime_type: string;
  @ApiProperty() size_bytes: number;
  @ApiProperty() uploaded_by_user_id: string;
  @ApiProperty() created_at: string;
}

/** Detail view; also returned by every write. */
export class ApplicationDto extends ApplicationListItemDto {
  @ApiProperty() letter_text: string;
  @ApiProperty() letter_locale: string;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  granted: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  effect_result: Record<string, unknown> | null;
  @ApiProperty({ type: [ApplicationEventDto] }) events: ApplicationEventDto[];
  @ApiProperty({ type: [ApplicationTagDto] }) tags: ApplicationTagDto[];
  @ApiProperty({ type: [ApplicationAttachmentDto] }) attachments: ApplicationAttachmentDto[];
}

export class ApplicationListDto {
  @ApiProperty({ type: [ApplicationListItemDto] }) data: ApplicationListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class AddresseeUserDto {
  @ApiProperty() id: string;
  @ApiProperty() full_name: string;
}

export class AddresseeOptionDto {
  @ApiProperty({ enum: ApplicationAddressee, enumName: 'ApplicationAddressee' })
  addressee: ApplicationAddressee;
  @ApiProperty({ nullable: true, type: AddresseeUserDto }) user: AddresseeUserDto | null;
  @ApiProperty({ nullable: true, enum: UserRole, enumName: 'UserRole' }) role: UserRole | null;
}

export class TagUserOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' }) role: UserRole;
}

export class TagOptionsDto {
  @ApiProperty({ type: [TagUserOptionDto] }) users: TagUserOptionDto[];
  @ApiProperty({ enum: UserRole, enumName: 'UserRole', isArray: true }) roles: UserRole[];
}

export class LetterPreviewResultDto {
  @ApiProperty() letter_text: string;
  @ApiProperty() letter_locale: string;
}
