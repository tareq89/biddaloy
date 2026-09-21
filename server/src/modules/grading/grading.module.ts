import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';

/**
 * [20.1.1] Schema-only module for now: registers `GradingScale` and
 * `GradingBand` with TypeORM so the entities are available to later
 * grading tickets (CRUD service/controller land in a follow-up).
 */
@Module({
  imports: [TypeOrmModule.forFeature([GradingScale, GradingBand])],
})
export class GradingModule {}
