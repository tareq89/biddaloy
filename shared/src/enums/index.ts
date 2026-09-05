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
  OTHER = 'OTHER',
}

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
  ONLINE = 'ONLINE',
  CARD = 'CARD',
  UPI = 'UPI',
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
  ADVANCE = 'ADVANCE',
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
