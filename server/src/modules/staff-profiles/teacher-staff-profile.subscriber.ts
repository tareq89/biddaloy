import { EventSubscriber, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { Teacher } from '../academics/entities/teacher.entity';
import { StaffProfile } from './entities/staff-profile.entity';
import { isUniqueViolationOn } from './staff-profiles.service';

/** Bounds the retry loop below — see `StaffProfilesService.createFor`'s
 * identical constant for why a collision here is expected/recoverable. */
const MAX_EMPLOYEE_ID_ATTEMPTS = 5;

/**
 * `teachers.staff_profile_id` is NOT NULL as of the [36.1.1] migration, but
 * `UsersService.create` ([36.2.1]) is only one of several places a `Teacher`
 * row gets inserted — workbook restore (`teachers.tab.ts`) and a long tail
 * of pre-existing test fixtures across unrelated modules (`attendance`,
 * `classes`, `homework`, `search`, `routines`) all build one directly via
 * a repository, with no reason to know about `staff_profiles`.
 *
 * A single `beforeInsert` subscriber is the one-place fix for every one of
 * those call sites, present and future, instead of teaching each caller
 * about `staff_profiles` individually. Same find-or-create-by-`user_id` +
 * `EMP-<tenant_short>-<sequence>` scheme as
 * `StaffProfilesService.createFor` — inlined here (not calling that
 * service) because a TypeORM subscriber has no NestJS DI, only the event's
 * own transactional `EntityManager`.
 */
@EventSubscriber()
export class TeacherStaffProfileSubscriber implements EntitySubscriberInterface<Teacher> {
  listenTo() {
    return Teacher;
  }

  async beforeInsert(event: InsertEvent<Teacher>): Promise<void> {
    const teacher = event.entity;
    if (!teacher || teacher.staff_profile_id) return;

    const m = event.manager;
    let staffProfile = await m.findOne(StaffProfile, { where: { user_id: teacher.user_id } });
    if (!staffProfile) {
      // Same concurrent-insert race `StaffProfilesService.createFor`
      // documents: the `count` read isn't a reservation, so two inserts
      // racing for the same tenant can generate the same `employee_id`.
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_ATTEMPTS && !staffProfile; attempt++) {
        const count = await m.count(StaffProfile, { where: { tenant_id: teacher.tenant_id } });
        try {
          staffProfile = await m.save(
            StaffProfile,
            m.create(StaffProfile, {
              user_id: teacher.user_id,
              tenant_id: teacher.tenant_id,
              employee_id: `EMP-${teacher.tenant_id.slice(0, 8)}-${count + 1}`,
              joining_date: teacher.joining_date ?? null,
            }),
          );
        } catch (error) {
          if (!isUniqueViolationOn(error, 'UQ_staff_profiles_tenant_employee_id')) throw error;
          lastError = error;
        }
      }
      if (!staffProfile) throw lastError;
    }
    teacher.staff_profile_id = staffProfile.id;
  }
}
