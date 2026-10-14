import type { DemoSlice } from '../context';
import { Homework } from '../../../modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../../../modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../../../modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../../../modules/homework/entities/syllabus-topic.entity';
import { StudyPlan } from '../../../modules/study-plans/entities/study-plan.entity';
import { StudyPlanTemplate } from '../../../modules/study-plans/entities/study-plan-template.entity';
import { LessonDelivery } from '../../../modules/study-plans/entities/lesson-delivery.entity';
import { Program } from '../../../modules/programs/entities/program.entity';
import { ProgramMilestone } from '../../../modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../../../modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../../../modules/programs/entities/milestone-achievement.entity';

export const slice: DemoSlice = {
  name: 'learning',
  covers: [
    Homework,
    HomeworkAssignment,
    HomeworkSubmission,
    SyllabusTopic,
    StudyPlan,
    StudyPlanTemplate,
    LessonDelivery,
    Program,
    ProgramMilestone,
    ProgramEnrollment,
    MilestoneAchievement,
  ],
  owedBy: '58.3.04',
  run: async () => {},
};
