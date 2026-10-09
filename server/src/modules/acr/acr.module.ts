import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AcrFormVersion } from './entities/acr-form-version.entity';
import { AcrCriterion } from './entities/acr-criterion.entity';
import { AcrAssessment } from './entities/acr-assessment.entity';
import { AcrScore } from './entities/acr-score.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcrCriteriaService } from './acr-criteria.service';
import { AcrCriteriaController } from './acr-criteria.controller';
import { AcrAssessmentsService } from './acr-assessments.service';
import { AcrAssessmentsController } from './acr-assessments.controller';

/** [28.1.2] Registered once in AppModule (D25). [28.2.1] criteria; [28.2.2] assessments. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AcrFormVersion,
      AcrCriterion,
      AcrAssessment,
      AcrScore,
      UserTenant,
      AcademicYear,
    ]),
    AuditModule,
  ],
  controllers: [AcrCriteriaController, AcrAssessmentsController],
  providers: [AcrCriteriaService, AcrAssessmentsService],
  exports: [AcrCriteriaService, AcrAssessmentsService],
})
export class AcrModule {}
