import type { DemoSlice } from '../context';
import { StudentSubjectChoice } from '../../../modules/students/entities/student-subject-choice.entity';
import { StudentNote } from '../../../modules/students/entities/student-note.entity';
import { StudentPublicExam } from '../../../modules/students/entities/student-public-exam.entity';

export const slice: DemoSlice = {
  name: 'student-extras',
  covers: [StudentSubjectChoice, StudentNote, StudentPublicExam],
  owedBy: '58.2.04',
  run: async () => {},
};
