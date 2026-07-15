export declare enum UserRole {
    SUPER_ADMIN = "SUPER_ADMIN",
    ADMIN = "ADMIN",
    ACCOUNTANT = "ACCOUNTANT",
    TEACHER = "TEACHER",
    PARENT = "PARENT",
    STUDENT = "STUDENT",
    EXECUTIVE = "EXECUTIVE"
}
export declare enum UserStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    SUSPENDED = "SUSPENDED"
}
export declare enum CommunicationMedium {
    SMS = "SMS",
    WHATSAPP = "WHATSAPP",
    EMAIL = "EMAIL",
    PHONE_CALL = "PHONE_CALL",
    MESSENGER = "MESSENGER"
}
export declare enum TeacherDesignation {
    CLASS_TEACHER = "CLASS_TEACHER",
    SUBJECT_TEACHER = "SUBJECT_TEACHER",
    HEAD_TEACHER = "HEAD_TEACHER",
    ASSISTANT_TEACHER = "ASSISTANT_TEACHER",
    PRINCIPAL = "PRINCIPAL",
    VICE_PRINCIPAL = "VICE_PRINCIPAL",
    COORDINATOR = "COORDINATOR"
}
export declare enum FeeType {
    MONTHLY_TUITION = "MONTHLY_TUITION",
    EXAM_FEE = "EXAM_FEE",
    LIBRARY_FEE = "LIBRARY_FEE",
    LAB_FEE = "LAB_FEE",
    SPORTS_FEE = "SPORTS_FEE",
    COMPUTER_FEE = "COMPUTER_FEE",
    TRANSPORT_FEE = "TRANSPORT_FEE",
    ANNUAL_FEE = "ANNUAL_FEE",
    ADMISSION_FEE = "ADMISSION_FEE",
    OTHER = "OTHER"
}
export declare enum FeeApplicability {
    ALL = "ALL",
    SELECTED = "SELECTED"
}
export declare enum FeeStatus {
    PENDING = "PENDING",
    PARTIALLY_PAID = "PARTIALLY_PAID",
    PAID = "PAID",
    OVERDUE = "OVERDUE",
    WAIVED = "WAIVED",
    ADVANCE = "ADVANCE"
}
export declare enum PaymentMethod {
    CASH = "CASH",
    CHEQUE = "CHEQUE",
    BANK_TRANSFER = "BANK_TRANSFER",
    ONLINE = "ONLINE",
    CARD = "CARD",
    UPI = "UPI"
}
export declare enum PaymentStatus {
    SUCCESS = "SUCCESS",
    PENDING = "PENDING",
    FAILED = "FAILED",
    REFUNDED = "REFUNDED"
}
export declare enum PaymentAllocationType {
    DUE = "DUE",
    CURRENT = "CURRENT",
    ADVANCE = "ADVANCE"
}
export declare enum InvoiceStatus {
    DRAFT = "DRAFT",
    ISSUED = "ISSUED",
    PAID = "PAID",
    CANCELLED = "CANCELLED",
    OVERDUE = "OVERDUE"
}
export declare enum CommunicationStatus {
    QUEUED = "QUEUED",
    SENT = "SENT",
    DELIVERED = "DELIVERED",
    FAILED = "FAILED",
    READ = "READ"
}
export declare enum CommunicationTrigger {
    MANUAL = "MANUAL",
    AUTOMATED = "AUTOMATED",
    BULK_REMINDER = "BULK_REMINDER"
}
export declare enum ReminderBatchStatus {
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    PARTIALLY_FAILED = "PARTIALLY_FAILED",
    FAILED = "FAILED"
}
export declare enum AuditAction {
    CREATE = "CREATE",
    UPDATE = "UPDATE",
    DELETE = "DELETE",
    LOGIN = "LOGIN",
    LOGOUT = "LOGOUT",
    PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
    INVOICE_GENERATED = "INVOICE_GENERATED",
    BULK_UPLOAD = "BULK_UPLOAD",
    REMINDER_SENT = "REMINDER_SENT",
    FEE_STRUCTURE_CHANGE = "FEE_STRUCTURE_CHANGE"
}
export declare enum EnrollmentStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    TRANSFERRED = "TRANSFERRED",
    GRADUATED = "GRADUATED"
}
//# sourceMappingURL=index.d.ts.map