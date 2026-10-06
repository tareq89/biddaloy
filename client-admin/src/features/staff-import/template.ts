import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
import { i18n } from '@biddaloy/ui/i18n';
import { downloadCsv } from '@biddaloy/ui/utils';

/** Column keys, in sheet order — each maps to `staffImport:columns.<key>.label`. */
export const STAFF_COLUMNS = ['name', 'phone', 'email', 'role', 'designation'] as const;
export type StaffColumn = (typeof STAFF_COLUMNS)[number];

/** Roles an import may grant — mirrors the server's `IMPORTABLE_ROLES`
 * (staff roles, never SUPER_ADMIN). */
export const IMPORTABLE_ROLES: readonly UserRole[] = STAFF_ROLES.filter(
  (role) => role !== UserRole.SUPER_ADMIN,
);

/**
 * Downloads the staff sample sheet in the current language. The server accepts
 * English or Bangla headers and role labels, so the file matches what the
 * person sees on screen. Async only because the two namespaces load lazily;
 * `PeopleStep`'s `onDownloadStaffSample` takes it as-is.
 */
export async function downloadStaffTemplate(): Promise<void> {
  await i18n.loadNamespaces(['staffImport', 'staff']);
  const t = i18n.getFixedT(null, 'staffImport');
  const tStaff = i18n.getFixedT(null, 'staff');
  const header = STAFF_COLUMNS.map((column) => t(`columns.${column}.label`));
  const rows = [
    ['Rahim Uddin', '01712345678', '', tStaff(`roles.${UserRole.TEACHER}`), 'Assistant Teacher'],
    ['Karim Hossain', '', 'karim@example.com', tStaff(`roles.${UserRole.ACCOUNTANT}`), ''],
  ];
  downloadCsv('staff-import-template.csv', [header, ...rows]);
}
