// [28.1.4] Body factories for the Epic 28 evaluations e2e helpers (ACR,
// incidents, surveys). Shapes come from the shared DTOs (#1226).
import type {
  AcrAssessmentResponse,
  CreateIncidentRequest,
  CreateSurveyRequest,
  IncidentResponse,
  SaveAcrAssessmentRequest,
  SurveyResponse,
} from '@biddaloy/shared';

export type {
  AcrAssessmentResponse as AcrResponse,
  CreateIncidentRequest as CreateIncidentBody,
  CreateSurveyRequest as CreateSurveyBody,
  IncidentResponse,
  SaveAcrAssessmentRequest as CreateAcrBody,
  SurveyResponse,
};

export function acrBody(
  staffId: string,
  academicYearId: string,
  over: Partial<SaveAcrAssessmentRequest> = {},
): SaveAcrAssessmentRequest {
  return { staffId, academicYearId, scores: [], ...over };
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
  academicYearId: string,
  over: Partial<CreateSurveyRequest> = {},
): CreateSurveyRequest {
  return { title, respondent: 'BOTH', academicYearId, ...over };
}
