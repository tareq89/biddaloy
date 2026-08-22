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
export { useAccessToken, useActiveRole, useActiveTenant } from './auth-state';
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
  type StudentSortField,
} from './students';
export { paymentKeys, useCreatePayment, type CreatePaymentInput, type Payment } from './payments';
export { hasPermission, useHasPermission } from './permissions';
export {
  classKeys,
  classesQueryOptions,
  classSectionsQueryOptions,
  useClasses,
  useClassSections,
  type Class,
  type ClassSection,
  type PaginatedClasses,
} from './classes';
export {
  useSendBulkReminder,
  type ReminderBatchResponse,
  type SendBulkReminderInput,
} from './reminders';
export { useRouteFocus, type UseRouteFocusOptions } from './use-route-focus';
export { useDebouncedValue } from './use-debounce';
export { invoiceKeys, useInvoice, type Invoice, type InvoiceListFilters } from './invoices';
export {
  useGlobalSearch,
  type GlobalSearchEntityResult,
  type GlobalSearchResults,
  type Guardian,
  type TeacherProfile,
} from './global-search';
export { useNotifications, useUnreadNotificationCount } from './notifications';
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
