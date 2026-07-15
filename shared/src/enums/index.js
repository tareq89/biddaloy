"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnrollmentStatus = exports.AuditAction = exports.ReminderBatchStatus = exports.CommunicationTrigger = exports.CommunicationStatus = exports.InvoiceStatus = exports.PaymentAllocationType = exports.PaymentStatus = exports.PaymentMethod = exports.FeeStatus = exports.FeeApplicability = exports.FeeType = exports.TeacherDesignation = exports.CommunicationMedium = exports.UserStatus = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["SUPER_ADMIN"] = "SUPER_ADMIN";
    UserRole["ADMIN"] = "ADMIN";
    UserRole["ACCOUNTANT"] = "ACCOUNTANT";
    UserRole["TEACHER"] = "TEACHER";
    UserRole["PARENT"] = "PARENT";
    UserRole["STUDENT"] = "STUDENT";
    UserRole["EXECUTIVE"] = "EXECUTIVE";
})(UserRole || (exports.UserRole = UserRole = {}));
var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVE"] = "ACTIVE";
    UserStatus["INACTIVE"] = "INACTIVE";
    UserStatus["SUSPENDED"] = "SUSPENDED";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
var CommunicationMedium;
(function (CommunicationMedium) {
    CommunicationMedium["SMS"] = "SMS";
    CommunicationMedium["WHATSAPP"] = "WHATSAPP";
    CommunicationMedium["EMAIL"] = "EMAIL";
    CommunicationMedium["PHONE_CALL"] = "PHONE_CALL";
    CommunicationMedium["MESSENGER"] = "MESSENGER";
})(CommunicationMedium || (exports.CommunicationMedium = CommunicationMedium = {}));
var TeacherDesignation;
(function (TeacherDesignation) {
    TeacherDesignation["CLASS_TEACHER"] = "CLASS_TEACHER";
    TeacherDesignation["SUBJECT_TEACHER"] = "SUBJECT_TEACHER";
    TeacherDesignation["HEAD_TEACHER"] = "HEAD_TEACHER";
    TeacherDesignation["ASSISTANT_TEACHER"] = "ASSISTANT_TEACHER";
    TeacherDesignation["PRINCIPAL"] = "PRINCIPAL";
    TeacherDesignation["VICE_PRINCIPAL"] = "VICE_PRINCIPAL";
    TeacherDesignation["COORDINATOR"] = "COORDINATOR";
})(TeacherDesignation || (exports.TeacherDesignation = TeacherDesignation = {}));
var FeeType;
(function (FeeType) {
    FeeType["MONTHLY_TUITION"] = "MONTHLY_TUITION";
    FeeType["EXAM_FEE"] = "EXAM_FEE";
    FeeType["LIBRARY_FEE"] = "LIBRARY_FEE";
    FeeType["LAB_FEE"] = "LAB_FEE";
    FeeType["SPORTS_FEE"] = "SPORTS_FEE";
    FeeType["COMPUTER_FEE"] = "COMPUTER_FEE";
    FeeType["TRANSPORT_FEE"] = "TRANSPORT_FEE";
    FeeType["ANNUAL_FEE"] = "ANNUAL_FEE";
    FeeType["ADMISSION_FEE"] = "ADMISSION_FEE";
    FeeType["OTHER"] = "OTHER";
})(FeeType || (exports.FeeType = FeeType = {}));
var FeeApplicability;
(function (FeeApplicability) {
    FeeApplicability["ALL"] = "ALL";
    FeeApplicability["SELECTED"] = "SELECTED";
})(FeeApplicability || (exports.FeeApplicability = FeeApplicability = {}));
var FeeStatus;
(function (FeeStatus) {
    FeeStatus["PENDING"] = "PENDING";
    FeeStatus["PARTIALLY_PAID"] = "PARTIALLY_PAID";
    FeeStatus["PAID"] = "PAID";
    FeeStatus["OVERDUE"] = "OVERDUE";
    FeeStatus["WAIVED"] = "WAIVED";
    FeeStatus["ADVANCE"] = "ADVANCE";
})(FeeStatus || (exports.FeeStatus = FeeStatus = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["CASH"] = "CASH";
    PaymentMethod["CHEQUE"] = "CHEQUE";
    PaymentMethod["BANK_TRANSFER"] = "BANK_TRANSFER";
    PaymentMethod["ONLINE"] = "ONLINE";
    PaymentMethod["CARD"] = "CARD";
    PaymentMethod["UPI"] = "UPI";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["SUCCESS"] = "SUCCESS";
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["FAILED"] = "FAILED";
    PaymentStatus["REFUNDED"] = "REFUNDED";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var PaymentAllocationType;
(function (PaymentAllocationType) {
    PaymentAllocationType["DUE"] = "DUE";
    PaymentAllocationType["CURRENT"] = "CURRENT";
    PaymentAllocationType["ADVANCE"] = "ADVANCE";
})(PaymentAllocationType || (exports.PaymentAllocationType = PaymentAllocationType = {}));
var InvoiceStatus;
(function (InvoiceStatus) {
    InvoiceStatus["DRAFT"] = "DRAFT";
    InvoiceStatus["ISSUED"] = "ISSUED";
    InvoiceStatus["PAID"] = "PAID";
    InvoiceStatus["CANCELLED"] = "CANCELLED";
    InvoiceStatus["OVERDUE"] = "OVERDUE";
})(InvoiceStatus || (exports.InvoiceStatus = InvoiceStatus = {}));
var CommunicationStatus;
(function (CommunicationStatus) {
    CommunicationStatus["QUEUED"] = "QUEUED";
    CommunicationStatus["SENT"] = "SENT";
    CommunicationStatus["DELIVERED"] = "DELIVERED";
    CommunicationStatus["FAILED"] = "FAILED";
    CommunicationStatus["READ"] = "READ";
})(CommunicationStatus || (exports.CommunicationStatus = CommunicationStatus = {}));
var CommunicationTrigger;
(function (CommunicationTrigger) {
    CommunicationTrigger["MANUAL"] = "MANUAL";
    CommunicationTrigger["AUTOMATED"] = "AUTOMATED";
    CommunicationTrigger["BULK_REMINDER"] = "BULK_REMINDER";
})(CommunicationTrigger || (exports.CommunicationTrigger = CommunicationTrigger = {}));
var ReminderBatchStatus;
(function (ReminderBatchStatus) {
    ReminderBatchStatus["PROCESSING"] = "PROCESSING";
    ReminderBatchStatus["COMPLETED"] = "COMPLETED";
    ReminderBatchStatus["PARTIALLY_FAILED"] = "PARTIALLY_FAILED";
    ReminderBatchStatus["FAILED"] = "FAILED";
})(ReminderBatchStatus || (exports.ReminderBatchStatus = ReminderBatchStatus = {}));
var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "CREATE";
    AuditAction["UPDATE"] = "UPDATE";
    AuditAction["DELETE"] = "DELETE";
    AuditAction["LOGIN"] = "LOGIN";
    AuditAction["LOGOUT"] = "LOGOUT";
    AuditAction["PAYMENT_RECEIVED"] = "PAYMENT_RECEIVED";
    AuditAction["INVOICE_GENERATED"] = "INVOICE_GENERATED";
    AuditAction["BULK_UPLOAD"] = "BULK_UPLOAD";
    AuditAction["REMINDER_SENT"] = "REMINDER_SENT";
    AuditAction["FEE_STRUCTURE_CHANGE"] = "FEE_STRUCTURE_CHANGE";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
var EnrollmentStatus;
(function (EnrollmentStatus) {
    EnrollmentStatus["ACTIVE"] = "ACTIVE";
    EnrollmentStatus["INACTIVE"] = "INACTIVE";
    EnrollmentStatus["TRANSFERRED"] = "TRANSFERRED";
    EnrollmentStatus["GRADUATED"] = "GRADUATED";
})(EnrollmentStatus || (exports.EnrollmentStatus = EnrollmentStatus = {}));
//# sourceMappingURL=index.js.map