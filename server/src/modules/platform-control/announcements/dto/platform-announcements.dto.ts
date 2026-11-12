import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AlertSeverity, SchoolStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

export class PreviewAnnouncementDto {
  @ApiProperty({ enum: SchoolStatus, enumName: 'SchoolStatus', isArray: true })
  @IsEnum(SchoolStatus, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  statusFilter: SchoolStatus[];
}

export class SendAnnouncementDto extends PreviewAnnouncementDto {
  @ApiProperty({ maxLength: 140 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  @SanitizeText()
  title: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @SanitizeText()
  body: string;

  @ApiProperty({ enum: [AlertSeverity.WARNING, AlertSeverity.REMINDER] })
  @IsIn([AlertSeverity.WARNING, AlertSeverity.REMINDER])
  severity: AlertSeverity;

  @ApiProperty()
  @IsBoolean()
  sms: boolean;

  @ApiProperty()
  @IsBoolean()
  email: boolean;
}

export class ListAnnouncementsQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface AnnouncementPreviewDto {
  schools: number;
  people: number;
}

/** What one send did. Never carries the message body. */
export interface AnnouncementDto {
  id: string;
  title: string;
  severity: string;
  statusFilter: string[];
  sms: boolean;
  email: boolean;
  schoolsTargeted: number;
  schoolsSucceeded: number;
  recipientCount: number;
  createdByName: string | null;
  createdAt: string;
}

export interface AnnouncementListDto {
  items: AnnouncementDto[];
  total: number;
}
