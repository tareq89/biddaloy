import { AdmissionApplicantStatus, AdmissionDocumentType } from '../enums/admission';

/** [27.1] One document an applicant has uploaded. */
export interface AdmissionApplicantDocument {
  type: AdmissionDocumentType;
  storage_key: string;
}

/** [27.1] A reviewer's decision on an `AdmissionApplicant`. */
export type AdmissionEvaluationDecision = 'SHORTLIST' | 'ADMIT' | 'REJECT';

/** Request/response shape for an `AdmissionIntake` row. */
export interface AdmissionIntakeDto {
  id: string;
  class_section_id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
  created_at: string;
  updated_at: string;
}

/** Request/response shape for an `AdmissionApplicant` row. */
export interface AdmissionApplicantDto {
  id: string;
  intake_id: string;
  reference_number: string;
  applicant_name: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string | null;
  home_address: string | null;
  documents: AdmissionApplicantDocument[];
  status: AdmissionApplicantStatus;
  created_at: string;
  updated_at: string;
}

/** Request/response shape for an `AdmissionEvaluation` row. */
export interface AdmissionEvaluationDto {
  id: string;
  applicant_id: string;
  reviewer_user_id: string;
  notes: string;
  decision: AdmissionEvaluationDecision | null;
  created_at: string;
}
