import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, UserRole, roleHasPermission } from '@biddaloy/shared';
import { Student } from '../students/entities/student.entity';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import {
  SearchGuardianResult,
  SearchInvoiceResult,
  SearchPaymentResult,
  SearchQueryDto,
  SearchResultsDto,
  SearchStaffResult,
  SearchStudentResult,
} from './dto/search.dto';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/** [8.9.9]'s `useGlobalSearch` gates the teacher/staff group on this exact
 * role list rather than a `Permission` (there is no dedicated one for
 * `GET /teachers` yet — see that hook's own doc comment). Mirrored here so
 * this endpoint's staff group opens to exactly the same roles the UI
 * already lets query it, not a wider or narrower set. */
const STAFF_SEARCH_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
];

/** [30.2.1] Unified, permission-filtered, tenant-scoped palette query
 * behind `GET /search` — one round trip answering the palette's People
 * tab across students, guardians, staff, invoices and payments, in place
 * of the five separate list requests `useGlobalSearch` makes today.
 *
 * **Permission filtering happens here, not just at the controller.** The
 * controller's `@RequirePermissions` only gates the route as a whole
 * (the caller must hold at least `STUDENT_READ`); which of the five
 * groups actually appear in the response is decided per-group in
 * `search()` below, against the caller's *own* resolved role — so a
 * caller who reaches this method without ever passing through
 * `PermissionsGuard` (there is none such a caller today, but defense in
 * depth doesn't get to assume that stays true) still cannot pull a group
 * they don't hold the permission for. A group the caller cannot read is
 * left off the returned object entirely, not returned as `[]` — the
 * caller-visible difference between "you may not see this" and "nothing
 * matched".
 *
 * **Every query is tenant-scoped from the resolved context** (`tenantId`
 * threaded as an explicit parameter, never ambient) **and parameterized**
 * — `q` is only ever bound as a `$n` placeholder, never concatenated into
 * SQL text, including the cross-entity guardian-phone branch.
 *
 * D7 note: once Epic 33.0 (branches) lands, branch filtering belongs
 * here — this endpoint becomes the single place the palette's People
 * results get scoped to the caller's active branch.
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async search(tenantId: string, role: UserRole, query: SearchQueryDto): Promise<SearchResultsDto> {
    const term = normalizeSearchTerm(query.q);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const result: SearchResultsDto = {};
    const jobs: Array<Promise<void>> = [];

    // Empty query -> every permitted group is present but empty, and no
    // query runs at all (Tests: "empty q returns empty groups without
    // querying").
    if (roleHasPermission(role, Permission.STUDENT_READ)) {
      jobs.push(
        (term ? this.searchStudents(tenantId, term, limit) : Promise.resolve([])).then((rows) => {
          result.students = rows;
        }),
      );
    }
    if (roleHasPermission(role, Permission.GUARDIAN_READ)) {
      jobs.push(
        (term ? this.searchGuardians(tenantId, term, limit) : Promise.resolve([])).then((rows) => {
          result.guardians = rows;
        }),
      );
    }
    if (STAFF_SEARCH_ROLES.includes(role)) {
      jobs.push(
        (term ? this.searchStaff(tenantId, term, limit) : Promise.resolve([])).then((rows) => {
          result.staff = rows;
        }),
      );
    }
    if (roleHasPermission(role, Permission.INVOICE_READ)) {
      jobs.push(
        (term ? this.searchInvoices(tenantId, term, limit) : Promise.resolve([])).then((rows) => {
          result.invoices = rows;
        }),
      );
    }
    if (roleHasPermission(role, Permission.PAYMENT_READ)) {
      jobs.push(
        (term ? this.searchPayments(tenantId, term, limit) : Promise.resolve([])).then((rows) => {
          result.payments = rows;
        }),
      );
    }

    await Promise.all(jobs);
    return result;
  }

  /** Student branch, one round trip covering both match kinds: a direct
   * hit on the student's own name/registration/roll/class-section, and
   * the cross-entity rule (Step 4) — a `term` matching a linked
   * guardian's phone also surfaces that guardian's students, flagged
   * `matched_via: 'guardian_phone'`. The guardian match is an `EXISTS`
   * subquery, not a join, so there is exactly one row per student and no
   * `DISTINCT ON` is needed — results are ordered by name like the other
   * four branches. Every join carries its own `tenant_id` check — a join
   * alone never implies same-tenant (`student_guardians` in particular
   * doesn't). */
  private async searchStudents(
    tenantId: string,
    term: string,
    limit: number,
  ): Promise<SearchStudentResult[]> {
    const like = `%${term}%`;
    const isPlainInteger = /^\d+$/.test(term) && Number(term) <= 2147483647;
    const rollNumber = isPlainInteger ? Number(term) : null;

    const rows = await this.studentRepo.manager.query<
      Array<{
        id: string;
        full_name: string;
        registration_number: string;
        roll_number: number;
        class_name: string | null;
        section_name: string | null;
        matched_via: 'direct' | 'guardian_phone';
      }>
    >(
      `SELECT
         s.id, s.full_name, s.registration_number, s.roll_number,
         c.name AS class_name, cs.section_name AS section_name,
         CASE
           WHEN s.full_name ILIKE $2 OR s.registration_number ILIKE $2 OR s.roll_number = $4
             OR c.name ILIKE $2 OR cs.section_name ILIKE $2
             THEN 'direct'
           ELSE 'guardian_phone'
         END AS matched_via
       FROM students s
       LEFT JOIN class_sections cs ON cs.id = s.class_section_id
       LEFT JOIN classes c ON c.id = cs.class_id
       WHERE s.tenant_id = $1
         AND s.deleted_at IS NULL
         AND (
           s.full_name ILIKE $2
           OR s.registration_number ILIKE $2
           OR s.roll_number = $4
           OR c.name ILIKE $2
           OR cs.section_name ILIKE $2
           OR EXISTS (
             SELECT 1 FROM student_guardians sg
             INNER JOIN guardians g ON g.id = sg.guardian_id
             WHERE sg.student_id = s.id
               AND g.tenant_id = $1
               AND g.deleted_at IS NULL
               AND g.phone ILIKE $2
           )
         )
       ORDER BY s.full_name ASC
       LIMIT $3`,
      [tenantId, like, limit, rollNumber],
    );

    return rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      registration_number: r.registration_number,
      roll_number: r.roll_number,
      class_name: r.class_name,
      section_name: r.section_name,
      matched_via: r.matched_via,
    }));
  }

  private async searchGuardians(
    tenantId: string,
    term: string,
    limit: number,
  ): Promise<SearchGuardianResult[]> {
    const like = `%${term}%`;
    const rows = await this.studentRepo.manager.query<
      Array<{ id: string; full_name: string; phone: string | null }>
    >(
      `SELECT g.id, g.full_name, g.phone
       FROM guardians g
       WHERE g.tenant_id = $1
         AND g.deleted_at IS NULL
         AND (g.full_name ILIKE $2 OR g.phone ILIKE $2)
       ORDER BY g.full_name ASC
       LIMIT $3`,
      [tenantId, like, limit],
    );
    return rows;
  }

  /** Staff (teachers) branch — joined through `users` for `full_name`,
   * same as `TeacherService`'s own reads. `teachers` has no `tenant_id`
   * of its own reused across staff kinds today, so this is exactly that
   * one row's own `tenant_id` column, not a derived join. */
  private async searchStaff(
    tenantId: string,
    term: string,
    limit: number,
  ): Promise<SearchStaffResult[]> {
    const like = `%${term}%`;
    const rows = await this.studentRepo.manager.query<
      Array<{ id: string; full_name: string; employee_id: string }>
    >(
      `SELECT t.id, u.full_name, t.employee_id
       FROM teachers t
       INNER JOIN users u ON u.id = t.user_id
       WHERE t.tenant_id = $1
         AND t.deleted_at IS NULL
         AND (u.full_name ILIKE $2 OR t.employee_id ILIKE $2)
       ORDER BY u.full_name ASC
       LIMIT $3`,
      [tenantId, like, limit],
    );
    return rows;
  }

  /** Invoices have no `tenant_id` column of their own — tenant scope
   * comes through the owning student, exactly the pattern
   * `InvoicesController.findOne` already uses (`invoice.student.tenant_id
   * !== tenantId`). Matches `invoice_number` OR the linked student's
   * `full_name`, mirroring `InvoicesService`'s own `findAll` search
   * predicate (`invoice.invoice_number ILIKE :search OR student.full_name
   * ILIKE :search`) — the join is already here for `student_name` display,
   * so this reuses it rather than adding a second one. */
  private async searchInvoices(
    tenantId: string,
    term: string,
    limit: number,
  ): Promise<SearchInvoiceResult[]> {
    const like = `%${term}%`;
    const rows = await this.studentRepo.manager.query<
      Array<{ id: string; invoice_number: string; student_name: string | null }>
    >(
      `SELECT i.id, i.invoice_number, s.full_name AS student_name
       FROM invoices i
       INNER JOIN students s ON s.id = i.student_id
       WHERE s.tenant_id = $1
         AND s.deleted_at IS NULL
         AND i.deleted_at IS NULL
         AND (i.invoice_number ILIKE $2 OR s.full_name ILIKE $2)
       ORDER BY i.invoice_number ASC
       LIMIT $3`,
      [tenantId, like, limit],
    );
    return rows;
  }

  /** Matches `transaction_reference` OR the linked student's `full_name`
   * OR `registration_number`, mirroring `PaymentsQueryService`'s own
   * `findAll` search predicate (`payment.transaction_reference ILIKE
   * :search OR student.full_name ILIKE :search OR student.registration_number
   * ILIKE :search`). The student join also carries its own `deleted_at IS
   * NULL`, matching `PaymentsQueryService`'s `leftJoinAndSelect('payment.student',
   * 'student', 'student.deleted_at IS NULL')` — otherwise a soft-deleted
   * student's name would still render in `student_name`. */
  private async searchPayments(
    tenantId: string,
    term: string,
    limit: number,
  ): Promise<SearchPaymentResult[]> {
    const like = `%${term}%`;
    const rows = await this.studentRepo.manager.query<
      Array<{ id: string; transaction_reference: string | null; student_name: string | null }>
    >(
      `SELECT p.id, p.transaction_reference, s.full_name AS student_name
       FROM payments p
       LEFT JOIN students s ON s.id = p.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
       WHERE p.tenant_id = $1
         AND p.deleted_at IS NULL
         AND (
           p.transaction_reference ILIKE $2
           OR s.full_name ILIKE $2
           OR s.registration_number ILIKE $2
         )
       ORDER BY p.transaction_reference ASC
       LIMIT $3`,
      [tenantId, like, limit],
    );
    return rows;
  }
}
