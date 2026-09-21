import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { AuditModule } from '../audit/audit.module';
import { GradingService } from './grading.service';
import { RecomputeService, RESULT_RECOMPUTER, NoopResultRecomputer } from './recompute.service';
import { GradingController } from './grading.controller';

/**
 * [20.2.1] `GradingScale`/`GradingBand` CRUD, copy, and the approval-gated
 * band recompute flow. `AcademicYear`/`Class` are registered entity-only
 * (no cross-module import) so `GradingService` can validate a scale's
 * `academic_year_id`/`class_id` belong to the caller's tenant — same
 * reasoning as `classes.module.ts`'s own comment on why it does this for
 * `Teacher`/`Student`.
 *
 * `RESULT_RECOMPUTER` is bound to `NoopResultRecomputer` here — Epic 19.0
 * (`#901`) provides the real implementation once it lands (#781 D17: this
 * epic merges first); swapping the binding is the only change that needs
 * to happen in this module when it does.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GradingScale, GradingBand, AcademicYear, Class]),
    AuditModule,
  ],
  providers: [
    GradingService,
    RecomputeService,
    { provide: RESULT_RECOMPUTER, useClass: NoopResultRecomputer },
  ],
  controllers: [GradingController],
  exports: [GradingService, RecomputeService],
})
export class GradingModule {}
