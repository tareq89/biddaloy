import { describe, expect, it } from 'vitest';

import {
  AcrCriterionBlock,
  AcrScore,
  AcrStatus,
  IncidentSeverity,
  IncidentType,
  SurveyRespondent,
  SurveyStatus,
} from './evaluations';

describe('evaluations enums', () => {
  it('score tuple is exactly 4,3,2,1', () => {
    expect([...AcrScore]).toEqual([4, 3, 2, 1]);
  });
  it('enum values are unique', () => {
    for (const e of [
      AcrStatus,
      AcrCriterionBlock,
      IncidentType,
      IncidentSeverity,
      SurveyStatus,
      SurveyRespondent,
    ]) {
      const v = Object.values(e);
      expect(new Set(v).size).toBe(v.length);
    }
  });
});
