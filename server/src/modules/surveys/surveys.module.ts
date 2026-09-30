import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Survey } from './entities/survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyTarget } from './entities/survey-target.entity';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/** [28.1.2] Shell registered once in AppModule (D25). [28.2.4] adds the lifecycle routes. */
@Module({
  imports: [TypeOrmModule.forFeature([Survey, SurveyQuestion, SurveyTarget, TeacherClassSection])],
  controllers: [SurveysController],
  providers: [SurveysService],
})
export class SurveysModule {}
