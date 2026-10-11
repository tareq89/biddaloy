import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { AuditModule } from '../audit/audit.module';
import { GradingService } from './grading.service';
import { RecomputeService, RESULT_RECOMPUTER } from './recompute.service';
import { ExamsModule } from '../exams/exams.module';
import { ExamResultRecomputer } from '../exams/result-recomputer.service';
import { GradingController } from './grading.controller';
import { Result } from '../exams/entities/result.entity';

/**
 * [20.2.1] `GradingScale`/`GradingBand` CRUD, copy, and the approval-gated
 * band recompute flow. `AcademicYear`/`Class` are registered entity-only
 * (no cross-module import) so `GradingService` can validate a scale's
 * `academic_year_id`/`class_id` belong to the caller's tenant — same
 * reasoning as `classes.module.ts`'s own comment on why it does this for
 * `Teacher`/`Student`.
 *
 * `RESULT_RECOMPUTER` is bound to the exams module's `ExamResultRecomputer`
 * [68.2.06]: a band edit recomputes every PROCESSED exam that uses the scale
 * and is refused while PUBLISHED results use it (D16).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GradingScale, GradingBand, AcademicYear, Class, Result]),
    AuditModule,
    ExamsModule,
  ],
  providers: [
    GradingService,
    RecomputeService,
    { provide: RESULT_RECOMPUTER, useExisting: ExamResultRecomputer },
  ],
  controllers: [GradingController],
  exports: [GradingService, RecomputeService],
})
export class GradingModule {}
