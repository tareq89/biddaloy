import type { DemoSlice } from '../context';
import { Student } from '../../../modules/students/entities/student.entity';
import { Guardian } from '../../../modules/students/entities/guardian.entity';
import { Enrollment } from '../../../modules/students/entities/enrollment.entity';
import { PromotionRun } from '../../../modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../../../modules/promotions/entities/promotion-entry.entity';
import { StudentLifecycleEvent } from '../../../modules/students/entities/student-lifecycle-event.entity';

export const slice: DemoSlice = {
  name: 'students',
  covers: [Student, Guardian, Enrollment, PromotionRun, PromotionEntry, StudentLifecycleEvent],
  owedBy: '58.2.03',
  run: async () => {},
};
