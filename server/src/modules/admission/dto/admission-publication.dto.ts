import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const PUBLISH_WHAT = ['STAGE', 'MERIT', 'WAITING'] as const;
export type PublishWhat = (typeof PUBLISH_WHAT)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class PublishDto {
  @ApiProperty({ enum: PUBLISH_WHAT })
  @IsIn(PUBLISH_WHAT)
  what: PublishWhat;

  @ApiProperty({ format: 'uuid', description: 'Stage id (STAGE) or list id (MERIT, WAITING).' })
  @IsUUID()
  ref_id: string;

  @ApiProperty()
  @IsBoolean()
  send_sms: boolean;

  @ApiPropertyOptional({ description: 'Also SMS not-passed / rejected applicants (D26: off).' })
  @IsOptional()
  @IsBoolean()
  include_not_selected?: boolean;
}

export class PublishEstimateQueryDto {
  @ApiProperty({ enum: PUBLISH_WHAT })
  @IsIn(PUBLISH_WHAT)
  what: PublishWhat;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ref_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  include_not_selected?: boolean;
}

export class PublishResponseDto {
  @ApiProperty() published_at: string;
  @ApiProperty() already_published: boolean;
  @ApiProperty({ description: 'SMS handed to the sender; 0 when send_sms is false or repeated.' })
  sms_attempted: number;
}

export class PublishEstimateResponseDto {
  @ApiProperty() recipients: number;
  @ApiProperty({ description: 'SMS segments (credits) the send will use.' }) segments: number;
  @ApiProperty() metered: boolean;
  @ApiProperty({ nullable: true, type: Number }) available: number | null;
  @ApiProperty() already_published: boolean;
}

export class CallListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  list_id: string;
}

export class CallListRowDto {
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty() name: string;
  @ApiProperty() phone: string;
  @ApiProperty({ nullable: true, type: String }) roll: string | null;
  @ApiProperty() called: boolean;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

export class SetCalledDto {
  @ApiProperty()
  @IsBoolean()
  called: boolean;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SetCalledResponseDto {
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty() called: boolean;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}
