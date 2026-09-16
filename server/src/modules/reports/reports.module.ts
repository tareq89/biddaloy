import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../fees/entities/payment.entity';
import { CollectionsReportService } from './collections-report.service';
import { ReportsController } from './reports.controller';

/** [16.6.2] Reports module — read-only aggregate views over data owned by
 * other modules (fees/payments). Registers `Payment` for `TypeOrmModule`
 * so its `Repository`'s `manager` can run the report's raw aggregate SQL,
 * which also reaches into `payment_allocations`, `student_fees`,
 * `fee_structures`, `invoices`, `students`, and `users` — all already
 * migrated by their owning modules, so no entities beyond `Payment` need
 * registering here. */
@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  providers: [CollectionsReportService],
  controllers: [ReportsController],
})
export class ReportsModule {}
