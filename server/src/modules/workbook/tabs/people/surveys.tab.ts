import { Survey } from '../../../surveys/entities/survey.entity';
import { SurveyAnswer } from '../../../surveys/entities/survey-answer.entity';
import { SurveyQuestion } from '../../../surveys/entities/survey-question.entity';
import { SurveyResponse } from '../../../surveys/entities/survey-response.entity';
import { SurveyTarget } from '../../../surveys/entities/survey-target.entity';
import { subjectsTab } from '../academics/subjects.tab';
import { createRefChildTab } from './ref-child-tab.factory';
import { teachersTab } from './teachers.tab';
import { usersTab } from './users.tab';

/**
 * [28.1.3] Epic 28.0's survey tabs, defined in restore order
 * (surveys -> questions -> targets -> responses -> answers). Responses keep
 * `respondent` even on anonymous surveys: a backup is admin-only and the
 * DB unique key (survey, respondent, teacher, subject) must restore intact.
 */
export const surveysTab = createRefChildTab<Survey>({
  name: 'surveys',
  entityClass: Survey,
  refs: [],
  fields: [
    { key: 'title', type: 'string', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
    {
      key: 'status',
      type: 'enum',
      enumValues: ['DRAFT', 'OPEN', 'CLOSED'],
      required: true,
      label: { en: 'Status', bn: 'অবস্থা' },
    },
    { key: 'anonymous', type: 'bool', required: true, label: { en: 'Anonymous', bn: 'বেনামী' } },
    {
      key: 'respondent',
      type: 'enum',
      enumValues: ['STUDENTS', 'GUARDIANS', 'BOTH'],
      required: true,
      label: { en: 'Respondent', bn: 'উত্তরদাতা' },
    },
    { key: 'opens_at', type: 'datetime', label: { en: 'Opens at', bn: 'শুরুর সময়' } },
    { key: 'closes_at', type: 'datetime', label: { en: 'Closes at', bn: 'শেষের সময়' } },
    { key: 'min_responses', type: 'int', required: true, label: { en: 'Min responses', bn: 'ন্যূনতম উত্তর' } },
    { key: 'created_at', type: 'datetime', required: true, label: { en: 'Created at', bn: 'তৈরির সময়' } },
  ],
  naturalKey: ['title', 'created_at'],
});

const survey = { key: 'survey', fk: 'survey_id', tab: surveysTab, label: { en: 'Survey', bn: 'জরিপ' } };
const teacher = { key: 'teacher', fk: 'teacher_id', tab: teachersTab, label: { en: 'Teacher', bn: 'শিক্ষক' } };
const subject = { key: 'subject', fk: 'subject_id', tab: subjectsTab, label: { en: 'Subject', bn: 'বিষয়' } };

export const surveyQuestionsTab = createRefChildTab<SurveyQuestion>({
  name: 'survey_questions',
  entityClass: SurveyQuestion,
  refs: [survey],
  fields: [
    { key: 'sort_order', type: 'int', required: true, label: { en: 'Order', bn: 'ক্রম' } },
    { key: 'text', type: 'string', required: true, label: { en: 'Question', bn: 'প্রশ্ন' } },
    { key: 'stars_enabled', type: 'bool', required: true, label: { en: 'Stars enabled', bn: 'তারকা চালু' } },
  ],
  naturalKey: ['survey', 'sort_order'],
});

export const surveyTargetsTab = createRefChildTab<SurveyTarget>({
  name: 'survey_targets',
  entityClass: SurveyTarget,
  refs: [survey, teacher, subject],
  fields: [],
  naturalKey: ['survey', 'teacher', 'subject'],
});

export const surveyResponsesTab = createRefChildTab<SurveyResponse>({
  name: 'survey_responses',
  entityClass: SurveyResponse,
  refs: [
    survey,
    { key: 'respondent', fk: 'respondent_user_id', tab: usersTab, label: { en: 'Respondent', bn: 'উত্তরদাতা' } },
    teacher,
    subject,
  ],
  fields: [
    { key: 'created_at', type: 'datetime', required: true, label: { en: 'Created at', bn: 'তৈরির সময়' } },
  ],
  naturalKey: ['survey', 'respondent', 'teacher', 'subject'],
});

export const surveyAnswersTab = createRefChildTab<SurveyAnswer>({
  name: 'survey_answers',
  entityClass: SurveyAnswer,
  refs: [
    { key: 'response', fk: 'response_id', tab: surveyResponsesTab, label: { en: 'Response', bn: 'উত্তরপত্র' } },
    { key: 'question', fk: 'question_id', tab: surveyQuestionsTab, label: { en: 'Question', bn: 'প্রশ্ন' } },
  ],
  fields: [
    { key: 'text', type: 'string', label: { en: 'Text', bn: 'লেখা' } },
    { key: 'stars', type: 'int', label: { en: 'Stars', bn: 'তারকা' } },
  ],
  naturalKey: ['response', 'question'],
});

export const surveysTabs = [
  surveysTab,
  surveyQuestionsTab,
  surveyTargetsTab,
  surveyResponsesTab,
  surveyAnswersTab,
];
