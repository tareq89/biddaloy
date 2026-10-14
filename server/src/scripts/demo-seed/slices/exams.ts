import type { DemoSlice } from '../context';
import { Exam } from '../../../modules/exams/entities/exam.entity';
import { ExamComponent } from '../../../modules/exams/entities/exam-component.entity';
import { ExamSchedule } from '../../../modules/exams/entities/exam-schedule.entity';
import { MarkGrid } from '../../../modules/exams/entities/mark-grid.entity';
import { Mark } from '../../../modules/exams/entities/mark.entity';
import { Result } from '../../../modules/exams/entities/result.entity';
import { ResultSubject } from '../../../modules/exams/entities/result-subject.entity';
import { SeatPlan } from '../../../modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from '../../../modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from '../../../modules/seat-plans/entities/seat-allocation.entity';

export const slice: DemoSlice = {
  name: 'exams',
  covers: [
    Exam,
    ExamComponent,
    ExamSchedule,
    MarkGrid,
    Mark,
    Result,
    ResultSubject,
    SeatPlan,
    SeatPlanSchedule,
    SeatAllocation,
  ],
  owedBy: '58.3.03',
  run: async () => {},
};
