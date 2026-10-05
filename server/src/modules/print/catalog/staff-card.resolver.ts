import type { EntityManager } from 'typeorm';
import { DocumentKind, EMPLOYEE_ROLES, UserRole } from '@biddaloy/shared';
import type { FieldResolver, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

interface Row {
  id: string;
  full_name: string;
  phone: string | null;
  name_bn: string | null;
  blood_group: string | null;
  designation: string | null;
  employee_id: string | null;
  photo_key: string | null;
}

/** Roles that get a staff ID card: every employee role. Not COMMITTEE (not an
 * employee, D16), PARENT, STUDENT or SUPER_ADMIN. */
export const STAFF_CARD_ROLES: readonly UserRole[] = EMPLOYEE_ROLES.filter(
  (role) => role !== UserRole.SUPER_ADMIN,
);

/** Subject id = user id. Only `STAFF_CARD_ROLES` members of `tenantId` resolve. */
export class StaffCardResolver implements FieldResolver {
  kind = DocumentKind.STAFF_ID_CARD;
  subjectType = 'STAFF' as const;

  async resolve(tenantId: string, subjectIds: string[], manager: EntityManager) {
    const rows: Row[] = await manager.query(
      `SELECT u.id, u.full_name, u.phone, h.name_bn, h.blood_group, d.title_en AS designation,
              t.employee_id, doc.storage_key AS photo_key
         FROM users u
         JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
              AND ut.deleted_at IS NULL
              AND ut.role::text = ANY($3::text[])
         LEFT JOIN staff_hr_records h ON h.user_id = u.id AND h.tenant_id = $1
         LEFT JOIN LATERAL (
           SELECT d2.title_en FROM staff_designation_history sh
             JOIN designations d2 ON d2.id = sh.designation_id
            WHERE sh.user_id = u.id AND sh.tenant_id = $1 AND sh.end_date IS NULL
            ORDER BY sh.effective_date DESC LIMIT 1) d ON true
         LEFT JOIN teachers t ON t.user_id = u.id AND t.tenant_id = $1 AND t.deleted_at IS NULL
         LEFT JOIN staff_documents doc ON doc.staff_user_id = u.id AND doc.tenant_id = $1
              AND doc.document_type = 'PHOTO'
        WHERE u.deleted_at IS NULL AND u.id = ANY($2::uuid[])`,
      [tenantId, subjectIds, STAFF_CARD_ROLES],
    );
    const school = await schoolValues(tenantId, manager);
    const out = new Map<string, ResolvedSubject>();
    for (const r of rows) {
      out.set(r.id, {
        label: r.full_name,
        photoKey: r.photo_key,
        values: {
          ...blankValues(this.kind),
          ...school,
          'staff.name': r.full_name,
          'staff.name_bn': r.name_bn ?? '',
          'staff.designation': r.designation ?? '',
          'staff.employee_id': r.employee_id ?? '',
          'staff.blood_group': r.blood_group ?? '',
          'staff.phone': r.phone ?? '',
        },
      });
    }
    return out;
  }
}
