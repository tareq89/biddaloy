import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AcrFormVersion } from './entities/acr-form-version.entity';
import { AcrCriterion } from './entities/acr-criterion.entity';
import { AcrCriteriaService } from './acr-criteria.service';
import { AcrCriteriaController } from './acr-criteria.controller';

/** [28.1.2] Registered once in AppModule (D25). [28.2.1] adds criteria read/save. */
@Module({
  imports: [TypeOrmModule.forFeature([AcrFormVersion, AcrCriterion]), AuditModule],
  controllers: [AcrCriteriaController],
  providers: [AcrCriteriaService],
  exports: [AcrCriteriaService],
})
export class AcrModule {}
