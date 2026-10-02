// UI: prefer generated API types (ui/src/api/schema.d.ts); these are not the wire shapes.
/** Epic 28.0 response/request shapes. Plain types; server DTO classes implement them. */
import type {
  AcrCriterionBlock,
  AcrScore,
  AcrStatus,
  IncidentSeverity,
  IncidentType,
  SurveyRespondent,
  SurveyStatus,
} from '../enums/evaluations';

export interface AcrCriterionResponse {
  id: string;
  block: AcrCriterionBlock;
  label: string;
  sortOrder: number;
}
export interface AcrCriteriaSetResponse {
  id: string;
  name: string;
  criteria: AcrCriterionResponse[];
}

export interface AcrScoreEntry {
  criterionId: string;
  score: AcrScore;
}
export interface SaveAcrAssessmentRequest {
  staffId: string;
  academicYearId: string;
  scores: AcrScoreEntry[];
  comment?: string;
}
export interface AcrAssessmentResponse {
  id: string;
  staffId: string;
  academicYearId: string;
  status: AcrStatus;
  scores: AcrScoreEntry[];
  /** Computed, never stored. */
  total: number;
  comment: string | null;
}

export interface CreateIncidentRequest {
  staffId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  occurredOn: string;
  description: string;
}
export interface IncidentResponse extends CreateIncidentRequest {
  id: string;
  createdAt: string;
}

export interface CreateSurveyRequest {
  title: string;
  respondent: SurveyRespondent;
  academicYearId: string;
}
export interface SurveyResponse extends CreateSurveyRequest {
  id: string;
  status: SurveyStatus;
}
export interface SurveyResultResponse {
  surveyId: string;
  /** True when responses are below the minimum N; the rest is then empty/zero. */
  hidden: boolean;
  count: number;
  average: number | null;
  comments: string[];
}

export interface StaffPerformanceResponse {
  staffId: string;
  academicYearId: string;
  acrTotal: number | null;
  incidentCount: number;
  surveyAverage: number | null;
}
export interface StudentPerformanceResponse {
  studentId: string;
  academicYearId: string;
  averageMarks: number | null;
  attendancePercent: number | null;
  incidentCount: number;
}
export interface SectionPerformanceResponse {
  sectionId: string;
  academicYearId: string;
  averageMarks: number | null;
  attendancePercent: number | null;
  studentCount: number;
}
export interface ClassPerformanceResponse {
  classId: string;
  academicYearId: string;
  averageMarks: number | null;
  attendancePercent: number | null;
  sections: SectionPerformanceResponse[];
}
