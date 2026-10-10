import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AlertSeverity, UserRole } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

const ids = (description: string) =>
  ApiPropertyOptional({ type: [String], format: 'uuid', description });

export class ManualAudienceDto {
  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole', isArray: true })
  @IsOptional()
  @IsEnum(UserRole, { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  roles?: UserRole[];

  @ids('Active students of these sections (those with a login).')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  sectionIds?: string[];

  @ids('Named users of this school.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  userIds?: string[];

  @ids('Guardians (with a login) of active students of these sections.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  guardiansOfSectionIds?: string[];
}

export class PreviewManualAlertDto {
  @ApiProperty({ type: ManualAudienceDto })
  @ValidateNested()
  @Type(() => ManualAudienceDto)
  audience: ManualAudienceDto;
}

export class CreateManualAlertDto extends PreviewManualAlertDto {
  @ApiProperty({ enum: [AlertSeverity.WARNING, AlertSeverity.REMINDER] })
  @IsIn([AlertSeverity.WARNING, AlertSeverity.REMINDER])
  severity: AlertSeverity;

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

  @ApiPropertyOptional({ example: '/routines/my', description: 'App-relative path only.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^\/(?!\/)[^\s\\]*$/, { message: 'actionUrl must be an app-relative path' })
  actionUrl?: string;

  @ApiProperty({
    example: '2026-10-10',
    description: 'Last day shown (school-local), up to 30 days out.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn: string;
}

export class ManualListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}

export class ManualAlertDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: AlertSeverity, enumName: 'AlertSeverity' }) severity: AlertSeverity;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ nullable: true, type: String }) actionUrl: string | null;
  @ApiProperty({ type: ManualAudienceDto }) audience: ManualAudienceDto;
  @ApiProperty({ format: 'date-time' }) raisedAt: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) expiresAt: string | null;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true, type: String }) createdByName: string | null;
  @ApiProperty() recipientCount: number;
  @ApiProperty() seenCount: number;
}

export class ManualAlertListDto {
  @ApiProperty({ type: [ManualAlertDto] }) items: ManualAlertDto[];
  @ApiProperty() total: number;
}

export class ManualAlertPreviewDto {
  @ApiProperty() recipientCount: number;
}
