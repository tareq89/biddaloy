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
  studentQueryOptions,
  studentsQueryOptions,
  useCreateStudent,
  useDeleteStudent,
  useStudent,
  useStudents,
  useUpdateStudent,
  useUpdateStudentEnrollmentStatus,
  useUpdateStudentPreferredCommunication,
  type CreateStudentInput,
  type EnrollmentStatus,
  type PaginatedStudents,
  type PreferredCommunication,
  type Student,
  type StudentListFilters,
  type StudentSortField,
  type UpdateStudentInput,
} from './students';
export {
  guardianKeys,
  useCreateGuardian,
  useGuardians,
  type CreateGuardianInput,
  type Guardian,
} from './guardians';
export {
  paymentKeys,
  useCreatePayment,
  usePaymentsByStudent,
  useStudentFeeSummary,
  useRecordPaymentWithAllocation,
  type CreatePaymentInput,
  type Payment,
  type PaymentAllocationInput,
  type RecordPaymentWithAllocationInput,
  type StudentFee,
  type StudentFeeSummary,
} from './payments';
export { enrollmentKeys, useStudentEnrollments, type Enrollment } from './enrollments';
export {
  communicationLogKeys,
  useStudentCommunicationLogs,
  useLastReminders,
  type CommunicationLog,
  type LastReminder,
} from './communications';
export {
  auditLogKeys,
  useAuditLogsByEntity,
  type AuditLog,
  type PaginatedAuditLogs,
} from './audit-logs';
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
export {
  invoiceKeys,
  invoicesQueryOptions,
  useCreateInvoice,
  useInvoice,
  useInvoices,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceListFilters,
  type PaginatedInvoices,
} from './invoices';
export {
  feeDuesKeys,
  feeDuesQueryOptions,
  useFeeDues,
  type FeeDueEntry,
  type FeeDueRow,
  type FeeDuesFilters,
  type FeeDuesSortBy,
  type PaginatedFeeDues,
  type SortOrder,
} from './fee-dues';
export {
  useGlobalSearch,
  type GlobalSearchEntityResult,
  type GlobalSearchResults,
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
