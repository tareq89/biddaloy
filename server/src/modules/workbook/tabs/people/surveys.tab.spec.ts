import { describe, expect, it } from 'vitest';
import { StaffIncident } from '../../../incidents/entities/staff-incident.entity';
import { Survey } from '../../../surveys/entities/survey.entity';
import { SurveyAnswer } from '../../../surveys/entities/survey-answer.entity';
import { SurveyQuestion } from '../../../surveys/entities/survey-question.entity';
import { SurveyResponse } from '../../../surveys/entities/survey-response.entity';
import { SurveyTarget } from '../../../surveys/entities/survey-target.entity';
import { EXPECTED_TABS } from '../../codec/registry';
import { staffIncidentsTab } from './incidents.tab';
import { roundTrip } from './ref-child-tab.test-helper';
import {
  surveyAnswersTab,
  surveyQuestionsTab,
  surveyResponsesTab,
  surveysTab,
  surveysTabs,
  surveyTargetsTab,
} from './surveys.tab';

const U = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const SUB = '44444444-4444-4444-8444-444444444444';
const Q = '55555555-5555-4555-8555-555555555555';
const R = '66666666-6666-4666-8666-666666666666';
const created = new Date('2026-05-01T09:00:00.000Z');
const SKEY = 'Term 1|2026-05-01T09:00:00.000Z';

const keys = {
  users: { [U]: 'a@x.test' },
  teachers: { [T]: 'EMP-1' },
  subjects: { [SUB]: 'MATH' },
  surveys: { [S]: SKEY },
  survey_questions: { [Q]: `${SKEY}|1` },
  survey_responses: { [R]: `${SKEY}|a@x.test|EMP-1|MATH` },
};

describe('staff_incidents tab', () => {
  it('round-trips', () => {
    const incident = Object.assign(new StaffIncident(), {
      id: R,
      staff_user_id: U,
      reported_by: U,
      type: 'COMMENDATION',
      severity: 'LOW',
      body: 'Great term',
      occurred_on: '2026-04-02',
      created_at: created,
    });
    expect(
      roundTrip(staffIncidentsTab, incident, { staff: 'a@x.test', reporter: 'a@x.test' }, keys),
    ).toMatchObject({ occurred_on: '2026-04-02', body: 'Great term' });
  });
});

describe('survey tabs', () => {
  it('are registered in restore order: surveys, questions, targets, responses, answers', () => {
    const idx = surveysTabs.map((t) => EXPECTED_TABS.indexOf(t.name as never));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(idx.every((i) => i >= 0)).toBe(true);
  });

  it('round-trips all five', () => {
    const survey = Object.assign(new Survey(), {
      id: S,
      title: 'Term 1',
      status: 'OPEN',
      anonymous: true,
      respondent: 'BOTH',
      opens_at: null,
      closes_at: created,
      min_responses: 5,
      created_at: created,
    });
    expect(roundTrip(surveysTab, survey, {}, keys)).toMatchObject({
      anonymous: true,
      min_responses: 5,
    });

    const question = Object.assign(new SurveyQuestion(), {
      id: Q,
      survey_id: S,
      sort_order: 1,
      text: 'Clear lessons?',
      stars_enabled: false,
    });
    expect(roundTrip(surveyQuestionsTab, question, { survey: SKEY }, keys)).toMatchObject({
      stars_enabled: false,
    });

    const target = Object.assign(new SurveyTarget(), {
      id: R,
      survey_id: S,
      teacher_id: T,
      subject_id: SUB,
    });
    roundTrip(surveyTargetsTab, target, { survey: SKEY, teacher: 'EMP-1', subject: 'MATH' }, keys);

    const response = Object.assign(new SurveyResponse(), {
      id: R,
      survey_id: S,
      respondent_user_id: U,
      teacher_id: T,
      subject_id: SUB,
      created_at: created,
    });
    roundTrip(
      surveyResponsesTab,
      response,
      { survey: SKEY, respondent: 'a@x.test', teacher: 'EMP-1', subject: 'MATH' },
      keys,
    );

    const answer = Object.assign(new SurveyAnswer(), {
      id: Q,
      response_id: R,
      question_id: Q,
      text: 'Yes',
      stars: 5,
    });
    expect(
      roundTrip(
        surveyAnswersTab,
        answer,
        { response: `${SKEY}|a@x.test|EMP-1|MATH`, question: `${SKEY}|1` },
        keys,
      ),
    ).toMatchObject({ stars: 5, text: 'Yes' });
  });
});
