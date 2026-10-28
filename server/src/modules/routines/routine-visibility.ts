import { Repository } from 'typeorm';
import { Permission, roleHasPermission, RoutineState, UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { Routine } from './entities/routine.entity';

/**
 * D11/D14: the one place that decides which slots of a routine a caller may read.
 * Used by `ResolveRoutineService` and `RoutineSlotsService.findForRoutine`, so the two
 * reads can never drift apart.
 *
 * - `'all'`: a manager (ROUTINE_MANAGE), or the routine is PUBLISHED.
 * - `'none'`: DRAFT for a non-manager; REVIEW for anyone but a TEACHER with a profile.
 * - `{ teacherId }`: REVIEW for a TEACHER: only slots they teach.
 */
export async function routineSlotScope(
  teacherRepo: Repository<Teacher>,
  routine: Pick<Routine, 'state'>,
  caller: { role: string; userId: string },
  tenantId: string,
): Promise<'all' | 'none' | { teacherId: string }> {
  if (roleHasPermission(caller.role, Permission.ROUTINE_MANAGE)) return 'all';
  if (routine.state === RoutineState.DRAFT) return 'none';
  if (routine.state !== RoutineState.REVIEW) return 'all';
  if (caller.role !== UserRole.TEACHER || !caller.userId) return 'none';
  const teacher = await teacherRepo.findOne({
    where: { user_id: caller.userId, tenant_id: tenantId },
  });
  return teacher ? { teacherId: teacher.id } : 'none';
}
