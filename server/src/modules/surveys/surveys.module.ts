import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import { FamilyAccessService } from '../students/family-access.service';
import { Survey } from './entities/survey.entity';
import { SurveyAnswer } from './entities/survey-answer.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyResponse } from './entities/survey-response.entity';
import { SurveyTarget } from './entities/survey-target.entity';
import { SurveyRespondController, SurveyResultsController } from './survey-respond.controller';
import { SurveyRespondService } from './survey-respond.service';
import { SurveyResultsService } from './survey-results.service';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/** [28.1.2] Shell registered once in AppModule (D25). [28.2.4] lifecycle, [28.4.2] respond + results. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Survey,
      SurveyQuestion,
      SurveyTarget,
      SurveyResponse,
      SurveyAnswer,
      TeacherClassSection,
      Teacher,
      Student,
    ]),
  ],
  // SurveyRespondController first: it owns `GET /surveys/mine`, which `SurveysController`'s `GET :id` would shadow.
  controllers: [SurveyRespondController, SurveyResultsController, SurveysController],
  providers: [SurveysService, SurveyRespondService, SurveyResultsService, FamilyAccessService],
})
export class SurveysModule {}
