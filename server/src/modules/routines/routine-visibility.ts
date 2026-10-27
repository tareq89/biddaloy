import { Repository } from 'typeorm';
import { isGuardianRole, Permission, roleHasPermission, RoutineState } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { Routine } from './entities/routine.entity';

/**
 * D11/D14: the one place that decides which slots of a routine a caller may read.
 * Used by `ResolveRoutineService` and `RoutineSlotsService.findForRoutine`, so the two
 * reads can never drift apart.
 *
 * - `'all'`: a manager (ROUTINE_MANAGE), or the routine is PUBLISHED.
 * - `'none'`: DRAFT for a non-manager; REVIEW for guardian roles, synthetic callers (no userId) and
 *   anyone without a teacher profile.
 * - `{ teacherId }`: REVIEW for any staff caller with a teacher profile (the profile decides, not the role): only slots they teach.
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
  if (isGuardianRole(caller.role) || !caller.userId) return 'none';
  const teacher = await teacherRepo.findOne({
    where: { user_id: caller.userId, tenant_id: tenantId },
  });
  return teacher ? { teacherId: teacher.id } : 'none';
}
