import { ApiProperty } from '@nestjs/swagger';
import { AdmissionApplicantStatus, AdmissionDocumentType } from '@biddaloy/shared';

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
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: string;
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
