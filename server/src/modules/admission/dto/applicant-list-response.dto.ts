import { ApiProperty } from '@nestjs/swagger';
import {
  AdmissionApplicantStatus,
  AdmissionDocumentType,
  AdmissionFeeState,
  AdmissionSource,
} from '@biddaloy/shared';

/** One uploaded document on an applicant. Mirrors `AdmissionApplicantDocument`. */
export class AdmissionApplicantDocumentDto {
  @ApiProperty({ enum: AdmissionDocumentType, enumName: 'AdmissionDocumentType' })
  type: AdmissionDocumentType;

  @ApiProperty()
  storage_key: string;
}

/** One applicant row. Mirrors the shared `AdmissionApplicantDto` field for field. */
export class AdmissionApplicantResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) intake_id: string;
  @ApiProperty() reference_number: string;
  @ApiProperty() applicant_name: string;
  @ApiProperty({ type: String, format: 'date' }) date_of_birth: string;
  @ApiProperty() gender: string;
  @ApiProperty() guardian_name: string;
  @ApiProperty() guardian_phone: string;
  @ApiProperty({ type: String, nullable: true }) guardian_email: string | null;
  @ApiProperty({ type: String, nullable: true }) home_address: string | null;
  @ApiProperty({ type: AdmissionApplicantDocumentDto, isArray: true })
  documents: AdmissionApplicantDocumentDto[];
  @ApiProperty({ enum: AdmissionApplicantStatus, enumName: 'AdmissionApplicantStatus' })
  status: AdmissionApplicantStatus;
  @ApiProperty({ type: String, nullable: true }) roll_number: string | null;
  @ApiProperty({ enum: Object.values(AdmissionSource), enumName: 'AdmissionSource' })
  source: AdmissionSource;
  @ApiProperty({ type: [String] }) quota_tags: string[];
  @ApiProperty({ type: 'object', additionalProperties: true })
  extra_fields: Record<string, unknown>;
  @ApiProperty({ enum: Object.values(AdmissionFeeState), enumName: 'AdmissionFeeState' })
  fee_state: AdmissionFeeState;
  @ApiProperty({ type: String, nullable: true, description: 'Method of the latest fee proof.' })
  fee_method: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Reference of the latest fee proof.' })
  fee_reference: string | null;
  @ApiProperty({ description: 'Sibling of an existing student.' }) has_sibling: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: string;
}

export class ApplicantDetailResponseDto {
  @ApiProperty({ type: AdmissionApplicantResponseDto }) applicant: AdmissionApplicantResponseDto;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  evaluations: Record<string, unknown>[];
}

/** `GET /admission/applicants` returns a page, not a bare array. */
export class ApplicantListResponseDto {
  @ApiProperty({ type: AdmissionApplicantResponseDto, isArray: true })
  data: AdmissionApplicantResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
