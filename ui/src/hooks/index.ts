/**
 * Shared hooks — URL state, pagination, permissions, auth, connectivity.
 *
 * `students.ts` is the reference implementation for [8.4.3]'s query
 * cache/invalidation conventions — `query-keys.ts`'s hierarchical
 * factory, `retry.ts`'s shared 4xx-doesn't-retry predicate, and
 * `tenant.ts`'s cache-clearing tenant switch. Later entities' hooks
 * should mirror `students.ts`'s shape rather than reinvent it — see
 * `ui/README.md`'s "Hooks" section for the full pattern write-up.
 */
export { createEntityKeys, type EntityKeys } from './query-keys';
export { shouldRetryQuery } from './retry';
export { switchActiveTenant } from './tenant';
export { login, logout, logoutAll } from './auth';
export {
  studentKeys,
  studentsQueryOptions,
  useCreateStudent,
  useStudent,
  useStudents,
  useUpdateStudentPreferredCommunication,
  type CreateStudentInput,
  type PaginatedStudents,
  type PreferredCommunication,
  type Student,
  type StudentListFilters,
} from './students';
export { paymentKeys, useCreatePayment, type CreatePaymentInput, type Payment } from './payments';
export { hasPermission, useHasPermission } from './permissions';
export {
  schoolsKeys,
  schoolSettingsKeys,
  useSchools,
  useSchoolSettings,
  useUpdateSchoolSettings,
  useTestSchoolConnection,
  type SchoolSummary,
  type MaskedSecret,
  type MaskedRegionSettings,
  type MaskedGreenwebSmsSettings,
  type MaskedMimSmsSettings,
  type MaskedSmsSettings,
  type MaskedWhatsAppSettings,
  type MaskedEmailSettings,
  type MaskedMessengerSettings,
  type MaskedCommunicationsSettings,
  type MaskedTenantSettings,
  type ConnectionTestResult,
  type TenantSettingsInput,
  type TestConnectionInput,
  type TestableMedium,
} from './school-settings';
