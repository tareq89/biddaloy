import type { DemoSlice } from '../context';
import { Routine } from '../../../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../../../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../../../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../../../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../../../modules/routines/entities/routine-change-request.entity';

export const slice: DemoSlice = {
  name: 'routine',
  covers: [Routine, RoutineSlot, RoutineSlotTeacher, RoutineSubstitution, RoutineChangeRequest],
  owedBy: '58.2.05',
  run: async () => {},
};
