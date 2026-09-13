export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  ACCOUNTANT = 'ACCOUNTANT',
  TEACHER = 'TEACHER',
  PARENT = 'PARENT',
  STUDENT = 'STUDENT',
  EXECUTIVE = 'EXECUTIVE',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/** Lifecycle status of a school/tenant (15.4). `SUSPENDED` schools stay in
 * place — no data loss, no soft delete — just access-gated by SUPER_ADMIN. */
export enum SchoolStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum CommunicationMedium {
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  PHONE_CALL = 'PHONE_CALL',
  MESSENGER = 'MESSENGER',
}

export enum TeacherDesignation {
  CLASS_TEACHER = 'CLASS_TEACHER',
  SUBJECT_TEACHER = 'SUBJECT_TEACHER',
  HEAD_TEACHER = 'HEAD_TEACHER',
  ASSISTANT_TEACHER = 'ASSISTANT_TEACHER',
  PRINCIPAL = 'PRINCIPAL',
  VICE_PRINCIPAL = 'VICE_PRINCIPAL',
  COORDINATOR = 'COORDINATOR',
}

export enum FeeType {
  MONTHLY_TUITION = 'MONTHLY_TUITION',
  EXAM_FEE = 'EXAM_FEE',
  LIBRARY_FEE = 'LIBRARY_FEE',
  LAB_FEE = 'LAB_FEE',
  SPORTS_FEE = 'SPORTS_FEE',
  COMPUTER_FEE = 'COMPUTER_FEE',
  TRANSPORT_FEE = 'TRANSPORT_FEE',
  ANNUAL_FEE = 'ANNUAL_FEE',
  ADMISSION_FEE = 'ADMISSION_FEE',
  LATE_FEE = 'LATE_FEE',
  OTHER = 'OTHER',
}

/**
 * @deprecated Slated for removal per Epic 16 decision D3, once every
 * `fee-generation.service.ts`-adjacent consumer drops it. #638 keeps it
 * alive on purpose — #639 and siblings still import it — do not delete
 * until those sibling tickets land their own removal.
 */
export enum FeeApplicability {
  ALL = 'ALL',
  SELECTED = 'SELECTED',
}

export enum FeeStatus {
  PENDING = 'PENDING',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  WAIVED = 'WAIVED',
  ADVANCE = 'ADVANCE',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CHEQUE = 'CHEQUE',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CARD = 'CARD',
  BKASH = 'BKASH',
  NAGAD = 'NAGAD',
  ROCKET = 'ROCKET',
}

export enum PaymentStatus {
  SUCCESS = 'SUCCESS',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentAllocationType {
  DUE = 'DUE',
  CURRENT = 'CURRENT',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  OVERDUE = 'OVERDUE',
}

export enum CommunicationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  READ = 'READ',
}

export enum CommunicationTrigger {
  MANUAL = 'MANUAL',
  AUTOMATED = 'AUTOMATED',
  BULK_REMINDER = 'BULK_REMINDER',
  SINGLE_REMINDER = 'SINGLE_REMINDER',
  /**
   * An account-access send (invitation, password reset, OTP, email/phone
   * verification) — 12.1. These logs exist so a send still shows up in the
   * communication trail, but `message_body` is redacted (secret replaced
   * with `••••••`); see `AccountAccessDeliveryService`.
   */
  ACCOUNT_ACCESS = 'ACCOUNT_ACCESS',
}

/** Purpose of a row in `auth_tokens` (12.1's D2). */
export enum AuthTokenPurpose {
  INVITE = 'INVITE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
}

export enum ReminderBatchStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  PARTIALLY_FAILED = 'PARTIALLY_FAILED',
  FAILED = 'FAILED',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  INVOICE_GENERATED = 'INVOICE_GENERATED',
  BULK_UPLOAD = 'BULK_UPLOAD',
  REMINDER_SENT = 'REMINDER_SENT',
  /**
   * A bulk-reminder preview. Nothing is sent, but the response names every
   * guardian, channel and contact address behind a filter — the same
   * exposure a send has, minus the message. Audited for the same reason
   * SETTINGS_TEST is: a read that hands back sensitive data still needs a
   * trace of who asked for it.
   */
  REMINDER_PREVIEWED = 'REMINDER_PREVIEWED',
  FEE_STRUCTURE_CHANGE = 'FEE_STRUCTURE_CHANGE',
  SETTINGS_CHANGE = 'SETTINGS_CHANGE',
  SETTINGS_TEST = 'SETTINGS_TEST',
  /** An invitation link was issued (create-without-password, or resend). */
  INVITATION_SENT = 'INVITATION_SENT',
  /** An invitation was revoked, either explicitly or superseded by a resend. */
  INVITATION_REVOKED = 'INVITATION_REVOKED',
  /** The invited user consumed their invite token and set a password. */
  ACCOUNT_ACTIVATED = 'ACCOUNT_ACTIVATED',
  /** A forgot-password request was accepted and an OTP/link was dispatched (or an admin-initiated reset was started). */
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  /** A password was actually changed via the OTP/link recovery flow (self-service or admin-initiated). */
  PASSWORD_RESET = 'PASSWORD_RESET',
  /** An email or phone was confirmed as owned by the account — activation,
   * OTP login, password reset, or the contact-change flow (12.7). */
  CONTACT_VERIFIED = 'CONTACT_VERIFIED',
  /** A refresh-token family was revoked via self-service session management
   * (12.8) — GET/DELETE /auth/sessions. */
  SESSION_REVOKED = 'SESSION_REVOKED',
  /** A SUPER_ADMIN suspended a school's access (15.4) — PATCH /schools/:id/status. */
  SUSPEND = 'SUSPEND',
  /** A SUPER_ADMIN reactivated a previously suspended school (15.4) — PATCH /schools/:id/status. */
  REACTIVATE = 'REACTIVATE',
  /** A backup/workbook artefact was pruned by retention (expiry, per-source
   * count cap, snapshot age, or the per-tenant storage cap) — 14.12.2.
   * Never fired for a `pinned` row. */
  BACKUP_DELETED = 'BACKUP_DELETED',
}

export enum EnrollmentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  TRANSFERRED = 'TRANSFERRED',
  GRADUATED = 'GRADUATED',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  LEAVE = 'LEAVE',
}

/**
 * Who produced an attendance mark. Teacher authority beats device
 * authority — see `AttendanceRecord`'s docstring.
 */
export enum AttendanceSource {
  TEACHER = 'TEACHER',
  DEVICE = 'DEVICE',
  IMPORT = 'IMPORT',
  SYSTEM = 'SYSTEM',
}

export enum AttendanceSessionState {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
}

export enum AttendanceDeviceKind {
  BIOMETRIC = 'BIOMETRIC',
  FACE = 'FACE',
  RFID = 'RFID',
  OTHER = 'OTHER',
}

export enum AttendanceDeviceStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum AttendanceEventDirection {
  IN = 'IN',
  OUT = 'OUT',
}

/** Fee-generation schedule cadence unit (16.x). */
export enum PeriodType {
  MONTH = 'MONTH',
  WEEK = 'WEEK',
}

/** How a fee-generation run was kicked off (16.x). */
export enum FeeGenerationSource {
  MANUAL = 'MANUAL',
  SCHEDULE = 'SCHEDULE',
}

/** What a fee-generation run does when it finds a duplicate fee already exists (16.x). */
export enum DuplicateStrategy {
  SKIP = 'SKIP',
  REMOVE_OLDER = 'REMOVE_OLDER',
  CREATE_ANYWAY = 'CREATE_ANYWAY',
}

/** Shape of a discount amount — a fixed value or a percentage (16.x). */
export enum DiscountKind {
  FLAT = 'FLAT',
  PERCENT = 'PERCENT',
}

/** Reason a `StudentWallet` balance moved (16.x). */
export enum WalletTransactionKind {
  CREDIT_OVERPAYMENT = 'CREDIT_OVERPAYMENT',
  CREDIT_CHANGE = 'CREDIT_CHANGE',
  DEBIT_CHECKOUT = 'DEBIT_CHECKOUT',
  DEBIT_GENERATION = 'DEBIT_GENERATION',
  REVERSAL = 'REVERSAL',
}

/** Whether an invoice document is a normal invoice or a credit note (16.x). */
export enum InvoiceKind {
  INVOICE = 'INVOICE',
  CREDIT_NOTE = 'CREDIT_NOTE',
}

/**
 * A gated action that requires step-up approval (OTP/password) before it can
 * proceed (16.x). String values are the permission-style scope names used
 * across server and clients — keep them in sync with any approval-scope
 * checks.
 */
export enum ApprovalScope {
  FEES_DUPLICATE_OVERRIDE = 'fees.duplicate_override',
  FEES_EDIT_PAID = 'fees.edit_paid',
  FEES_DISCOUNT = 'fees.discount',
  PAYMENTS_REVERSE = 'payments.reverse',
  DISCOUNT_RULES_MANAGE = 'discount_rules.manage',
}

/** How an `ApprovalToken` is verified (16.x). */
export enum ApprovalMode {
  OTP = 'OTP',
  OTP_OR_PASSWORD = 'OTP_OR_PASSWORD',
}

/** Cadence of a `RecurringSchedule` (16.x). */
export enum RecurrenceKind {
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY',
}
