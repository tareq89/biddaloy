import { Injectable } from '@nestjs/common';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import {
  APPLICATION_OVERRIDE_ROLES,
  APPLICATION_TYPES,
  ApplicationAddressee,
  ApplicationStatus,
  Permission,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import type { ApplicationStep, ApplicationType } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import type { Application } from './entities/application.entity';

/** SQL: the subject student's section has no class teacher now (orphan rule, D49). Needs `a`, `s`. */
const NO_CLASS_TEACHER = `s.class_section_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM teacher_class_sections otcs
    JOIN teachers ot ON ot.id = otcs.teacher_id AND ot.tenant_id = otcs.tenant_id
     AND ot.deleted_at IS NULL
   WHERE otcs.tenant_id = a.tenant_id AND otcs.section_id = s.class_section_id
     AND otcs.assignment_type = 'CLASS_TEACHER')`;

export type ApplicationCaller = { userId: string; role: UserRole };

const OPEN_STATUSES = [ApplicationStatus.PENDING, ApplicationStatus.UNDER_CONSIDERATION];

export function isOpenApplication(app: Pick<Application, 'status'>): boolean {
  return OPEN_STATUSES.includes(app.status);
}

export function isOverrideRole(role: string): boolean {
  return (APPLICATION_OVERRIDE_ROLES as readonly string[]).includes(role);
}

/**
 * Who may see and decide an application (D6, D7, D37, D49). One place, so the inbox SQL
 * (`applyInbox`) and the per-row check (`canDecide`) cannot drift apart.
 */
@Injectable()
export class ReviewerScopeService {
  constructor(private readonly familyAccess: FamilyAccessService) {}

  /** Live class teacher (D37): `CLASS_TEACHER` rows only, never the assistant. */
  async classTeacherUserId(
    manager: EntityManager,
    tenantId: string,
    studentId: string,
  ): Promise<string | null> {
    return (await this.classTeacherUserIds(manager, tenantId, studentId))[0] ?? null;
  }

  private async classTeacherUserIds(
    manager: EntityManager,
    tenantId: string,
    studentId: string,
  ): Promise<string[]> {
    const rows: Array<{ user_id: string }> = await manager.query(
      `SELECT DISTINCT t.user_id
         FROM students s
         JOIN teacher_class_sections tcs
           ON tcs.section_id = s.class_section_id AND tcs.tenant_id = s.tenant_id
          AND tcs.assignment_type = 'CLASS_TEACHER'
         JOIN teachers t
           ON t.id = tcs.teacher_id AND t.tenant_id = s.tenant_id AND t.deleted_at IS NULL
        WHERE s.id = $1 AND s.tenant_id = $2
        ORDER BY t.user_id`,
      [studentId, tenantId],
    );
    return rows.map((r) => r.user_id);
  }

  /** Sections where the caller is the (non-assistant) class teacher. */
  private async callerClassTeacherSectionIds(
    manager: EntityManager,
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const rows: Array<{ section_id: string }> = await manager.query(
      `SELECT DISTINCT tcs.section_id
         FROM teacher_class_sections tcs
         JOIN teachers t
           ON t.id = tcs.teacher_id AND t.tenant_id = tcs.tenant_id AND t.deleted_at IS NULL
        WHERE tcs.tenant_id = $1 AND t.user_id = $2 AND tcs.assignment_type = 'CLASS_TEACHER'`,
      [tenantId, userId],
    );
    return rows.map((r) => r.section_id);
  }

  /**
   * First step an application starts at. A leading `CLASS_TEACHER` step is skipped when the
   * subject is staff or the student has no class teacher now, but never the last step: a
   * last-step `CLASS_TEACHER` with nobody behind it stays, and override roles see it (D49).
   */
  async firstStepIndex(
    manager: EntityManager,
    app: Application,
  ): Promise<{ index: number; skipped: number[] }> {
    const steps = APPLICATION_TYPES[app.type].steps;
    if (steps.length > 1 && steps[0].kind === 'CLASS_TEACHER') {
      const noTeacher =
        !app.subject_student_id ||
        !(await this.classTeacherUserId(manager, app.tenant_id, app.subject_student_id));
      if (noTeacher) return { index: 1, skipped: [0] };
    }
    return { index: 0, skipped: [] };
  }

  private async stepMatches(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
    step: ApplicationStep,
  ): Promise<boolean> {
    switch (step.kind) {
      case 'CLASS_TEACHER':
        return this.isClassTeacherOf(manager, user, app);
      case 'ROLES':
        return step.roles.includes(user.role);
      case 'PERMISSION':
        return roleHasPermission(user.role, step.permission);
      case 'ADDRESSEE':
        switch (app.addressee) {
          case ApplicationAddressee.STAFF_USER:
            return app.addressee_user_id === user.userId;
          case ApplicationAddressee.HEADMASTER:
            return user.role === UserRole.ADMIN;
          case ApplicationAddressee.OFFICE:
            return user.role === UserRole.OFFICE_STAFF;
          case ApplicationAddressee.CLASS_TEACHER:
            return this.isClassTeacherOf(manager, user, app);
          default:
            return false;
        }
    }
  }

  private async isClassTeacherOf(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
  ): Promise<boolean> {
    if (!app.subject_student_id) return false;
    const ids = await this.classTeacherUserIds(manager, app.tenant_id, app.subject_student_id);
    return ids.includes(user.userId);
  }

  /**
   * D49 "own": the caller filed it, or is the subject staff member. A paper entry
   * (`applicant_name`, no `applicant_user_id`) for the caller's own staff profile is still theirs.
   */
  async isOwn(manager: EntityManager, user: ApplicationCaller, app: Application): Promise<boolean> {
    if (app.applicant_user_id === user.userId) return true;
    if (!app.subject_staff_profile_id) return false;
    const rows = await manager.query(
      `SELECT 1 FROM staff_profiles WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [app.subject_staff_profile_id, app.tenant_id, user.userId],
    );
    return rows.length > 0;
  }

  /** `'STEP'` = the caller passes the current step's rule; `'OVERRIDE'` = ADMIN/EXECUTIVE (D7). */
  async canDecide(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
  ): Promise<false | 'STEP' | 'OVERRIDE'> {
    if (!isOpenApplication(app)) return false;
    if (await this.isOwn(manager, user, app)) return false; // D49: nobody decides their own
    const step = APPLICATION_TYPES[app.type].steps[app.current_step];
    if (step && (await this.stepMatches(manager, user, app, step))) return 'STEP';
    return isOverrideRole(user.role) ? 'OVERRIDE' : false;
  }

  async canView(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
  ): Promise<boolean> {
    const me = user.userId;
    if (app.applicant_user_id === me || app.entered_by_user_id === me) return true;
    if (roleHasPermission(user.role, Permission.APPLICATION_MANAGE) || isOverrideRole(user.role)) {
      return true;
    }

    // Subject: the staff member themself, the student, or a linked guardian (D43).
    if (app.subject_staff_profile_id) {
      const own = await manager.query(
        `SELECT 1 FROM staff_profiles WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [app.subject_staff_profile_id, app.tenant_id, me],
      );
      if (own.length > 0) return true;
    }
    if (app.subject_student_id) {
      const linked = await this.familyAccess.getLinkedStudentIds(user.role, me, app.tenant_id);
      if (linked.includes(app.subject_student_id)) return true;
    }

    const seen = await manager.query(
      `SELECT 1 FROM application_tags
        WHERE application_id = $1 AND tenant_id = $2 AND (user_id = $3 OR role = $4)
       UNION ALL
       SELECT 1 FROM application_events
        WHERE application_id = $1 AND tenant_id = $2 AND actor_user_id = $3`,
      [app.id, app.tenant_id, me, user.role],
    );
    if (seen.length > 0) return true;

    return (await this.canDecide(manager, user, app)) !== false;
  }

  /**
   * The inbox, as SQL. Means the same as `canDecide(...) === 'STEP'`, plus the orphan rule:
   * override roles also get an application whose current step is `CLASS_TEACHER` and whose
   * section has no class teacher now (D49). Query alias is `a`; the caller joins
   * `students s ON s.id = a.subject_student_id AND s.tenant_id = a.tenant_id`.
   */
  async applyInbox(
    qb: SelectQueryBuilder<Application>,
    tenantId: string,
    user: ApplicationCaller,
  ): Promise<SelectQueryBuilder<Application>> {
    const ctSections = await this.callerClassTeacherSectionIds(
      qb.connection.manager,
      tenantId,
      user.userId,
    );
    const override = isOverrideRole(user.role);
    const params: Record<string, unknown> = {
      tenantId,
      me: user.userId,
      openStatuses: OPEN_STATUSES,
    };
    const clauses: string[] = [];
    let n = 0;
    const add = (type: string, step: number, cond: string) => {
      clauses.push(`(a.type = :t${n} AND a.current_step = :i${n} AND ${cond})`);
      params[`t${n}`] = type;
      params[`i${n}`] = step;
      n += 1;
    };

    for (const [type, def] of Object.entries(APPLICATION_TYPES) as Array<
      [ApplicationType, (typeof APPLICATION_TYPES)[ApplicationType]]
    >) {
      def.steps.forEach((step, i) => {
        switch (step.kind) {
          case 'ROLES':
            if (step.roles.includes(user.role)) add(type, i, 'TRUE');
            break;
          case 'PERMISSION':
            if (roleHasPermission(user.role, step.permission)) add(type, i, 'TRUE');
            break;
          case 'CLASS_TEACHER':
            if (ctSections.length > 0) add(type, i, 's.class_section_id IN (:...ctSections)');
            if (override) {
              add(type, i, NO_CLASS_TEACHER);
            }
            break;
          case 'ADDRESSEE': {
            const parts = [`(a.addressee = 'STAFF_USER' AND a.addressee_user_id = :me)`];
            if (override) {
              // canDecide gives override roles a class-teacher-addressed application whose
              // section has no class teacher now, so the inbox must too.
              parts.push(`(a.addressee = 'CLASS_TEACHER' AND ${NO_CLASS_TEACHER})`);
            }
            if (user.role === UserRole.ADMIN) parts.push(`a.addressee = 'HEADMASTER'`);
            if (user.role === UserRole.OFFICE_STAFF) parts.push(`a.addressee = 'OFFICE'`);
            if (ctSections.length > 0) {
              parts.push(
                `(a.addressee = 'CLASS_TEACHER' AND s.class_section_id IN (:...ctSections))`,
              );
            }
            add(type, i, `(${parts.join(' OR ')})`);
            break;
          }
        }
      });
    }
    if (ctSections.length > 0) params.ctSections = ctSections;

    qb.andWhere(
      `a.tenant_id = :tenantId AND a.status IN (:...openStatuses)
       AND a.applicant_user_id IS DISTINCT FROM :me
       AND NOT EXISTS (SELECT 1 FROM staff_profiles osp
                        WHERE osp.id = a.subject_staff_profile_id AND osp.tenant_id = a.tenant_id
                          AND osp.user_id = :me)`,
    ).andWhere(clauses.length > 0 ? `(${clauses.join(' OR ')})` : 'FALSE');
    return qb.setParameters(params);
  }

  /** Active tenant users for whom `canDecide` is `'STEP'` (override roles only for an orphaned
   * class-teacher step). 52.2.6 uses this to notify. */
  async currentDeciderUserIds(manager: EntityManager, app: Application): Promise<string[]> {
    if (!isOpenApplication(app)) return [];
    const step = APPLICATION_TYPES[app.type].steps[app.current_step];
    if (!step) return [];

    const byRole = (roles: readonly string[]) => this.activeUserIdsWithRoles(manager, app, roles);
    const byIds = (ids: string[]) => this.activeUserIdsWithRoles(manager, app, null, ids);

    let ids: string[] = [];
    const classTeacher = async () => {
      if (!app.subject_student_id) return [];
      const teachers = await this.classTeacherUserIds(
        manager,
        app.tenant_id,
        app.subject_student_id,
      );
      return teachers.length > 0 ? byIds(teachers) : byRole(APPLICATION_OVERRIDE_ROLES);
    };
    switch (step.kind) {
      case 'CLASS_TEACHER':
        ids = await classTeacher();
        break;
      case 'ROLES':
        ids = await byRole(step.roles);
        break;
      case 'PERMISSION':
        ids = await byRole(
          Object.values(UserRole).filter((r) => roleHasPermission(r, step.permission)),
        );
        break;
      case 'ADDRESSEE':
        if (app.addressee === ApplicationAddressee.STAFF_USER && app.addressee_user_id) {
          ids = await byIds([app.addressee_user_id]);
        } else if (app.addressee === ApplicationAddressee.HEADMASTER) {
          ids = await byRole([UserRole.ADMIN]);
        } else if (app.addressee === ApplicationAddressee.OFFICE) {
          ids = await byRole([UserRole.OFFICE_STAFF]);
        } else if (app.addressee === ApplicationAddressee.CLASS_TEACHER) {
          ids = await classTeacher();
        }
        break;
    }
    const [subject] = app.subject_staff_profile_id
      ? await manager.query(`SELECT user_id FROM staff_profiles WHERE id = $1 AND tenant_id = $2`, [
          app.subject_staff_profile_id,
          app.tenant_id,
        ])
      : [];
    return ids.filter((id) => id !== app.applicant_user_id && id !== subject?.user_id);
  }

  private async activeUserIdsWithRoles(
    manager: EntityManager,
    app: Application,
    roles: readonly string[] | null,
    userIds?: string[],
  ): Promise<string[]> {
    const rows: Array<{ user_id: string }> = await manager.query(
      `SELECT DISTINCT ut.user_id
         FROM user_tenants ut
         JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL
          AND ($2::text[] IS NULL OR ut.role::text = ANY($2))
          AND ($3::uuid[] IS NULL OR ut.user_id = ANY($3))`,
      [app.tenant_id, roles ? [...roles] : null, userIds ?? null],
    );
    return rows.map((r) => r.user_id);
  }
}
