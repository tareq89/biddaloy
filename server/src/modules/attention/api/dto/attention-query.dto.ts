import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AlertCategory, AlertSnoozeChoice, UserRole } from '@biddaloy/shared';

export class LocaleQueryDto {
  @ApiPropertyOptional({ enum: ['bn', 'en'] })
  @IsOptional()
  @IsIn(['bn', 'en'])
  locale?: 'bn' | 'en';
}

export class SummaryQueryDto extends LocaleQueryDto {
  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class ItemsQueryDto extends SummaryQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'history'], default: 'active' })
  @IsIn(['active', 'history'])
  tab: 'active' | 'history' = 'active';

  @ApiPropertyOptional({ enum: AlertCategory, enumName: 'AlertCategory' })
  @IsOptional()
  @IsEnum(AlertCategory)
  category?: AlertCategory;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() studentId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class SnoozeDto {
  @ApiProperty({ enum: ['TWO_HOURS', 'TOMORROW_MORNING', 'NEXT_SCHOOL_DAY', 'DATE'] })
  @IsIn(['TWO_HOURS', 'TOMORROW_MORNING', 'NEXT_SCHOOL_DAY', 'DATE'])
  choice: AlertSnoozeChoice;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, required when choice is DATE.' })
  @ValidateIf((o: SnoozeDto) => o.choice === 'DATE')
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class SeenDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  recipientIds: string[];
}
