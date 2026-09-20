import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '../students/entities/student.entity';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

/** [30.2.1] Search module — read-only aggregate view over data owned by
 * other modules (students/guardians/teachers/invoices/payments), modeled
 * on `server/src/modules/reports/reports.module.ts`. Registers only
 * `Student` for `TypeOrmModule` so `SearchService` can reach its
 * `Repository`'s `manager` for the raw parameterized SQL each branch
 * runs — the other four tables (`guardians`, `teachers`, `invoices`,
 * `payments`) are already migrated by their owning modules, so no
 * further entities need registering here. */
@Module({
  imports: [TypeOrmModule.forFeature([Student])],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}
