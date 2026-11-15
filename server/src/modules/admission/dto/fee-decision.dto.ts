import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionApplicantStatus, AdmissionFeeState } from '@biddaloy/shared';

const FEE_STATES = Object.values(AdmissionFeeState) as AdmissionFeeState[];

/** [71.G1.03] Query for `GET /admission/fee-proofs`. State defaults to AWAITING. */
export class ListFeeProofsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  intakeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "One applicant's proofs. Without `state`, every state is listed (their history).",
  })
  @IsOptional()
  @IsUUID()
  applicantId?: string;

  @ApiPropertyOptional({
    enum: FEE_STATES,
    enumName: 'AdmissionFeeState',
    default: 'AWAITING',
    description: 'Default AWAITING, except when `applicantId` is given (then all states).',
  })
  @IsOptional()
  @IsEnum(FEE_STATES)
  state?: AdmissionFeeState;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

/** [71.G1.03] Body of `POST /admission/fee-proofs/:id/send-back`. */
export class SendBackFeeProofDto {
  @ApiProperty({ maxLength: 300, description: 'Why the proof was refused. Sent to the guardian.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

export class FeeProofRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty({ format: 'uuid' }) intake_id: string;
  @ApiProperty() applicant_name: string;
  @ApiProperty() applicant_reference_number: string;
  @ApiProperty({ enum: AdmissionApplicantStatus, enumName: 'AdmissionApplicantStatus' })
  applicant_status: AdmissionApplicantStatus;
  @ApiProperty() method: string;
  @ApiProperty({ type: String, nullable: true }) reference: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Application fee of the round, whole paisa; null = the round has no fee.',
  })
  amount_paisa: number | null;
  @ApiProperty({ enum: FEE_STATES, enumName: 'AdmissionFeeState' }) state: AdmissionFeeState;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
  @ApiProperty({ description: 'Other proofs in this school carrying the same reference.' })
  seen_before: number;
}

export class FeeProofListResponseDto {
  @ApiProperty({ type: FeeProofRowDto, isArray: true }) data: FeeProofRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class FeeDecisionResponseDto {
  @ApiProperty({ format: 'uuid' }) proof_id: string;
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty({ enum: FEE_STATES, enumName: 'AdmissionFeeState' }) fee_state: AdmissionFeeState;
  @ApiProperty({ enum: AdmissionApplicantStatus, enumName: 'AdmissionApplicantStatus' })
  status: AdmissionApplicantStatus;
}
