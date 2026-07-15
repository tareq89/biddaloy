"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = exports.Permission = void 0;
var Permission;
(function (Permission) {
    // User Management
    Permission["USER_CREATE"] = "USER_CREATE";
    Permission["USER_READ"] = "USER_READ";
    Permission["USER_UPDATE"] = "USER_UPDATE";
    Permission["USER_DELETE"] = "USER_DELETE";
    // Student Management
    Permission["STUDENT_CREATE"] = "STUDENT_CREATE";
    Permission["STUDENT_READ"] = "STUDENT_READ";
    Permission["STUDENT_UPDATE"] = "STUDENT_UPDATE";
    Permission["STUDENT_DELETE"] = "STUDENT_DELETE";
    Permission["STUDENT_BULK_UPLOAD"] = "STUDENT_BULK_UPLOAD";
    // Guardian Management
    Permission["GUARDIAN_CREATE"] = "GUARDIAN_CREATE";
    Permission["GUARDIAN_READ"] = "GUARDIAN_READ";
    Permission["GUARDIAN_UPDATE"] = "GUARDIAN_UPDATE";
    // Fee Management
    Permission["FEE_STRUCTURE_CREATE"] = "FEE_STRUCTURE_CREATE";
    Permission["FEE_STRUCTURE_READ"] = "FEE_STRUCTURE_READ";
    Permission["FEE_STRUCTURE_UPDATE"] = "FEE_STRUCTURE_UPDATE";
    Permission["FEE_GENERATE"] = "FEE_GENERATE";
    Permission["FEE_READ"] = "FEE_READ";
    Permission["FEE_COLLECT"] = "FEE_COLLECT";
    // Invoice
    Permission["INVOICE_CREATE"] = "INVOICE_CREATE";
    Permission["INVOICE_READ"] = "INVOICE_READ";
    Permission["INVOICE_PRINT"] = "INVOICE_PRINT";
    Permission["INVOICE_DELETE"] = "INVOICE_DELETE";
    // Payment
    Permission["PAYMENT_RECORD"] = "PAYMENT_RECORD";
    Permission["PAYMENT_READ"] = "PAYMENT_READ";
    Permission["PAYMENT_REFUND"] = "PAYMENT_REFUND";
    // Communication
    Permission["COMMUNICATION_SEND"] = "COMMUNICATION_SEND";
    Permission["COMMUNICATION_BULK_SEND"] = "COMMUNICATION_BULK_SEND";
    Permission["COMMUNICATION_LOG_READ"] = "COMMUNICATION_LOG_READ";
    // Reports
    Permission["REPORTS_VIEW"] = "REPORTS_VIEW";
    Permission["REPORTS_EXPORT"] = "REPORTS_EXPORT";
    // Dashboard
    Permission["DASHBOARD_VIEW"] = "DASHBOARD_VIEW";
    Permission["DASHBOARD_ADMIN"] = "DASHBOARD_ADMIN";
    // Academic Structure
    Permission["ACADEMIC_YEAR_MANAGE"] = "ACADEMIC_YEAR_MANAGE";
    Permission["CLASS_MANAGE"] = "CLASS_MANAGE";
    // Audit
    Permission["AUDIT_LOG_READ"] = "AUDIT_LOG_READ";
    // Settings
    Permission["SETTINGS_MANAGE"] = "SETTINGS_MANAGE";
})(Permission || (exports.Permission = Permission = {}));
const index_1 = require("./index");
exports.ROLE_PERMISSIONS = {
    [index_1.UserRole.SUPER_ADMIN]: Object.values(Permission),
    [index_1.UserRole.ADMIN]: [
        Permission.USER_CREATE, Permission.USER_READ, Permission.USER_UPDATE,
        Permission.STUDENT_CREATE, Permission.STUDENT_READ, Permission.STUDENT_UPDATE, Permission.STUDENT_BULK_UPLOAD,
        Permission.GUARDIAN_CREATE, Permission.GUARDIAN_READ, Permission.GUARDIAN_UPDATE,
        Permission.FEE_STRUCTURE_CREATE, Permission.FEE_STRUCTURE_READ, Permission.FEE_STRUCTURE_UPDATE, Permission.FEE_GENERATE,
        Permission.FEE_READ, Permission.FEE_COLLECT,
        Permission.INVOICE_CREATE, Permission.INVOICE_READ, Permission.INVOICE_PRINT,
        Permission.PAYMENT_RECORD, Permission.PAYMENT_READ,
        Permission.COMMUNICATION_SEND, Permission.COMMUNICATION_BULK_SEND, Permission.COMMUNICATION_LOG_READ,
        Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT,
        Permission.DASHBOARD_VIEW, Permission.DASHBOARD_ADMIN,
        Permission.ACADEMIC_YEAR_MANAGE, Permission.CLASS_MANAGE,
        Permission.AUDIT_LOG_READ, Permission.SETTINGS_MANAGE,
    ],
    [index_1.UserRole.ACCOUNTANT]: [
        Permission.STUDENT_READ,
        Permission.GUARDIAN_READ,
        Permission.FEE_STRUCTURE_READ, Permission.FEE_GENERATE,
        Permission.FEE_READ, Permission.FEE_COLLECT,
        Permission.INVOICE_CREATE, Permission.INVOICE_READ, Permission.INVOICE_PRINT,
        Permission.PAYMENT_RECORD, Permission.PAYMENT_READ,
        Permission.COMMUNICATION_SEND, Permission.COMMUNICATION_BULK_SEND,
        Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT,
        Permission.DASHBOARD_VIEW,
    ],
    [index_1.UserRole.TEACHER]: [
        Permission.STUDENT_READ,
        Permission.GUARDIAN_READ,
        Permission.FEE_READ,
        Permission.COMMUNICATION_SEND,
        Permission.DASHBOARD_VIEW,
    ],
    [index_1.UserRole.PARENT]: [
        Permission.STUDENT_READ,
        Permission.FEE_READ,
        Permission.INVOICE_READ,
    ],
    [index_1.UserRole.STUDENT]: [
        Permission.STUDENT_READ,
        Permission.FEE_READ,
        Permission.INVOICE_READ,
    ],
    [index_1.UserRole.EXECUTIVE]: [
        Permission.STUDENT_READ,
        Permission.FEE_READ,
        Permission.REPORTS_VIEW,
        Permission.DASHBOARD_VIEW,
    ],
};
//# sourceMappingURL=permissions.js.map