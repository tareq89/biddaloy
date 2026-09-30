// [28.1.4] Typed request/response shapes + body factories for the Epic 28
// evaluations e2e helpers (ACR, incidents, surveys).
// TODO(28.0-integration): shared/src/dto/evaluations.ts (#1226) lands on the
// integration branch; swap these local interfaces for @biddaloy/shared DTOs.

export type AcrStatus = 'INCOMPLETE' | 'COMPLETED';
export type IncidentType = 'BEHAVIOUR' | 'ABSENCE' | 'COMPLAINT' | 'COMMENDATION' | 'OTHER';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type SurveyStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type SurveyRespondent = 'STUDENTS' | 'GUARDIANS' | 'BOTH';

export type CreateAcrBody = {
  staff_id: string;
  academic_year_id: string;
  status?: AcrStatus;
};
export interface AcrResponse {
  id: string;
  status: AcrStatus;
}

export type CreateIncidentBody = {
  staff_user_id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  occurred_on: string; // YYYY-MM-DD
  body: string;
};
export interface IncidentResponse {
  id: string;
}

export type CreateSurveyBody = {
  title: string;
  respondent: SurveyRespondent;
  status?: SurveyStatus;
};
export interface SurveyResponse {
  id: string;
  status: SurveyStatus;
}

export function acrBody(
  staffId: string,
  academicYearId: string,
  over: Partial<CreateAcrBody> = {},
): CreateAcrBody {
  return { staff_id: staffId, academic_year_id: academicYearId, ...over };
}

export function incidentBody(
  staffUserId: string,
  over: Partial<CreateIncidentBody> = {},
): CreateIncidentBody {
  return {
    staff_user_id: staffUserId,
    type: 'BEHAVIOUR',
    severity: 'LOW',
    occurred_on: '2026-01-15',
    body: 'e2e incident',
    ...over,
  };
}

export function surveyBody(title: string, over: Partial<CreateSurveyBody> = {}): CreateSurveyBody {
  return { title, respondent: 'BOTH', ...over };
}
