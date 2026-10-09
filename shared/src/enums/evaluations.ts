/** Epic 28.0 ACR/evaluation enums. Const-object + type pattern, like `homework.ts`. */

export const AcrStatus = { INCOMPLETE: 'INCOMPLETE', COMPLETED: 'COMPLETED' } as const;
export type AcrStatus = (typeof AcrStatus)[keyof typeof AcrStatus];

/** D5 — the 4-point scale, highest first. */
export const AcrScore = [4, 3, 2, 1] as const;
export type AcrScore = (typeof AcrScore)[number];

export const AcrCriterionBlock = { BLOCK_2: 'BLOCK_2', BLOCK_3: 'BLOCK_3' } as const;
export type AcrCriterionBlock = (typeof AcrCriterionBlock)[keyof typeof AcrCriterionBlock];

export const IncidentType = {
  BEHAVIOUR: 'BEHAVIOUR',
  ABSENCE: 'ABSENCE',
  COMPLAINT: 'COMPLAINT',
  COMMENDATION: 'COMMENDATION',
  OTHER: 'OTHER',
} as const;
export type IncidentType = (typeof IncidentType)[keyof typeof IncidentType];

export const IncidentSeverity = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const;
export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export const SurveyStatus = { DRAFT: 'DRAFT', OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;
export type SurveyStatus = (typeof SurveyStatus)[keyof typeof SurveyStatus];

export const SurveyRespondent = {
  STUDENTS: 'STUDENTS',
  GUARDIANS: 'GUARDIANS',
  BOTH: 'BOTH',
} as const;
export type SurveyRespondent = (typeof SurveyRespondent)[keyof typeof SurveyRespondent];
