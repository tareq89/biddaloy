// [28.1.4] Body factories for the Epic 28 evaluations e2e helpers (ACR,
// incidents, surveys). These are the WIRE shapes the server accepts (the
// server-local DTOs), not the `@biddaloy/shared` evaluations types, which
// disagree on field names for ACR and surveys.
import type { CreateIncidentRequest, IncidentResponse } from '@biddaloy/shared';

export type { CreateIncidentRequest as CreateIncidentBody, IncidentResponse };

export interface AcrCriterionBody {
  block: 'BLOCK_2' | 'BLOCK_3';
  code: string;
  label_en: string;
  label_bn: string;
  sort_order: number;
}
export type SaveAcrCriteriaBody = { criteria: AcrCriterionBody[] };
export interface CreateAcrBody {
  user_id: string;
  academic_year_id: string;
}
export interface AcrResponse {
  id: string;
  user_id: string;
  academic_year_id: string;
  status: 'INCOMPLETE' | 'COMPLETED';
  total: number | null;
  assessed_by: string;
  scores: { criterion_id: string; score: number }[];
}
export interface CreateSurveyBody {
  title: string;
  anonymous: boolean;
  respondent: 'STUDENTS' | 'GUARDIANS' | 'BOTH';
  questions: { text: string; starsEnabled: boolean }[];
  targets: { teacherId: string; subjectId: string }[];
  minResponses?: number;
}
export interface SurveyResponse {
  id: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  title: string;
}

export function acrCriteriaBody(): SaveAcrCriteriaBody {
  return {
    criteria: [{ block: 'BLOCK_2', code: 'e2e', label_en: 'E2E', label_bn: 'ই২ই', sort_order: 1 }],
  };
}

export function acrBody(userId: string, academicYearId: string): CreateAcrBody {
  return { user_id: userId, academic_year_id: academicYearId };
}

export function incidentBody(
  staffId: string,
  over: Partial<CreateIncidentRequest> = {},
): CreateIncidentRequest {
  return {
    staffId,
    type: 'BEHAVIOUR',
    severity: 'LOW',
    occurredOn: '2026-01-15',
    description: 'e2e incident',
    ...over,
  };
}

export function surveyBody(
  title: string,
  teacherId: string,
  subjectId: string,
  over: Partial<CreateSurveyBody> = {},
): CreateSurveyBody {
  return {
    title,
    anonymous: true,
    respondent: 'BOTH',
    questions: [{ text: 'Clear lessons?', starsEnabled: true }],
    targets: [{ teacherId, subjectId }],
    ...over,
  };
}
