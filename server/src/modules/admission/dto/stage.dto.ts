import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AdmissionStageKind } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateStageDto {
  @ApiProperty({ enum: Object.values(AdmissionStageKind), enumName: 'AdmissionStageKind' })
  @IsEnum(AdmissionStageKind)
  kind: AdmissionStageKind;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  title?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateStageDto extends PartialType(CreateStageDto) {}

/**
 * [71.4.00a] A stage as the desk reads it. `config` stays (the form edits it); the keys the desk
 * screens need are lifted out, typed. `max_score` is `config.total_marks`; `mode` is SCORE when
 * the stage has full marks, else PASS_FAIL (no marks, no cut-off), null for a NONE stage.
 */
export class AdmissionStageResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) intake_id: string;
  @ApiProperty() position: number;
  @ApiProperty({ enum: Object.values(AdmissionStageKind), enumName: 'AdmissionStageKind' })
  kind: AdmissionStageKind;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) config: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true, example: '2026-12-01' }) date: string | null;
  @ApiProperty({ type: String, nullable: true, example: '10:30' }) start_time: string | null;
  @ApiProperty({ type: String, nullable: true }) venue: string | null;
  @ApiProperty({ type: Number, nullable: true }) max_score: number | null;
  @ApiProperty({ enum: ['SCORE', 'PASS_FAIL'], nullable: true, type: String })
  mode: 'SCORE' | 'PASS_FAIL' | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cutoff_committed_at: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function toStageResponse(s: {
  id: string;
  intake_id: string;
  position: number;
  kind: AdmissionStageKind;
  title: string | null;
  config: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}): AdmissionStageResponseDto {
  const c = s.config ?? {};
  const total = Number(c.total_marks);
  const scored = c.total_marks !== undefined && c.total_marks !== null && Number.isFinite(total);
  return {
    id: s.id,
    intake_id: s.intake_id,
    position: s.position,
    kind: s.kind,
    title: s.title,
    config: c,
    date: str(c.date),
    start_time: str(c.start_time),
    venue: str(c.venue),
    max_score: scored ? total : null,
    mode: s.kind === 'NONE' ? null : scored ? 'SCORE' : 'PASS_FAIL',
    cutoff_committed_at: str(c.cutoff_committed_at),
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}
