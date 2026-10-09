import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IncidentSeverity, IncidentType } from '@biddaloy/shared';
import type { CreateIncidentRequest, IncidentResponse } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** Shared names (`staffId`, `description`) on the wire; the entity stores
 * `staff_user_id` / `body`. `attachments` is server-only for now (D15) and
 * must be empty, so media can slot in later without a contract break. */
export class CreateIncidentDto implements CreateIncidentRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffId: string;

  @ApiProperty({ enum: Object.values(IncidentType) })
  @IsIn(Object.values(IncidentType))
  type: IncidentType;

  @ApiProperty({ enum: Object.values(IncidentSeverity) })
  @IsIn(Object.values(IncidentSeverity))
  severity: IncidentSeverity;

  @ApiProperty({ example: '2026-09-30' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredOn: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @SanitizeText()
  description: string;

  @ApiPropertyOptional({ type: [String], description: 'Must be empty for now.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(0)
  attachments?: string[];
}

export class QueryIncidentsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffUserId?: string;

  @ApiPropertyOptional({ enum: Object.values(IncidentType) })
  @IsOptional()
  @IsIn(Object.values(IncidentType))
  type?: IncidentType;
}

export class IncidentResponseDto implements IncidentResponse {
  @ApiProperty() id: string;
  @ApiProperty() staffId: string;
  @ApiProperty({ enum: Object.values(IncidentType) }) type: IncidentType;
  @ApiProperty({ enum: Object.values(IncidentSeverity) }) severity: IncidentSeverity;
  @ApiProperty() occurredOn: string;
  @ApiProperty() description: string;
  @ApiProperty() createdAt: string;
}
