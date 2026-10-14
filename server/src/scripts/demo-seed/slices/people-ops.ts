import type { DemoSlice } from '../context';
import { AcrFormVersion } from '../../../modules/acr/entities/acr-form-version.entity';
import { AcrCriterion } from '../../../modules/acr/entities/acr-criterion.entity';
import { AcrAssessment } from '../../../modules/acr/entities/acr-assessment.entity';
import { AcrScore } from '../../../modules/acr/entities/acr-score.entity';
import { Survey } from '../../../modules/surveys/entities/survey.entity';
import { SurveyQuestion } from '../../../modules/surveys/entities/survey-question.entity';
import { SurveyTarget } from '../../../modules/surveys/entities/survey-target.entity';
import { SurveyResponse } from '../../../modules/surveys/entities/survey-response.entity';
import { SurveyAnswer } from '../../../modules/surveys/entities/survey-answer.entity';
import { StaffIncident } from '../../../modules/incidents/entities/staff-incident.entity';
import { AdmissionIntake } from '../../../modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../../../modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from '../../../modules/admission/entities/admission-evaluation.entity';

export const slice: DemoSlice = {
  name: 'people-ops',
  covers: [
    AcrFormVersion,
    AcrCriterion,
    AcrAssessment,
    AcrScore,
    Survey,
    SurveyQuestion,
    SurveyTarget,
    SurveyResponse,
    SurveyAnswer,
    StaffIncident,
    AdmissionIntake,
    AdmissionApplicant,
    AdmissionEvaluation,
  ],
  owedBy: '58.3.05',
  run: async () => {},
};
