"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearTables = clearTables;
exports.seedStudent = seedStudent;
exports.seedGuardian = seedGuardian;
exports.seedFeeStructure = seedFeeStructure;
exports.seedAcademicYear = seedAcademicYear;
exports.seedPayment = seedPayment;
/**
 * Database Helper for Tests
 *
 * Provides utilities to create test data in the database
 * and clean up between tests.
 */
/**
 * Clears all transactional tables while preserving seed data.
 * Call this in beforeEach() of integration/E2E tests.
 */
async function clearTables() {
    const { dataSource } = await Promise.resolve().then(() => __importStar(require('../setup')));
    if (!dataSource)
        return;
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
        const tables = [
            'students',
            'guardians',
            'student_guardians',
            'fee_structures',
            'fee_structure_students',
            'student_fees',
            'payments',
            'payment_allocations',
            'invoices',
            'communication_logs',
            'reminder_batches',
            'audit_logs',
            'enrollments',
            'teacher_class_sections',
            'teachers',
            'user_tenants',
        ];
        for (const table of tables) {
            await queryRunner.query(`TRUNCATE TABLE "${table}" CASCADE`);
        }
    }
    finally {
        await queryRunner.release();
    }
}
/**
 * Creates a test student in the database.
 */
async function seedStudent(dataSource, overrides = {}) {
    const repo = dataSource.getRepository('Student');
    const student = repo.create({
        full_name: 'Test Student',
        registration_number: 'REG-2026-0001',
        roll_number: 1,
        class_section_id: 'seed-section-1',
        tenant_id: 'seed-tenant-1',
        date_of_birth: '2010-01-01',
        gender: 'MALE',
        enrollment_status: 'ACTIVE',
        preferred_communication: 'SMS',
        ...overrides,
    });
    return repo.save(student);
}
/**
 * Creates a test guardian in the database.
 */
async function seedGuardian(dataSource, overrides = {}) {
    const repo = dataSource.getRepository('Guardian');
    const guardian = repo.create({
        full_name: 'Test Guardian',
        relationship: 'FATHER',
        phone: '+8801700000001',
        email: 'guardian@test.com',
        tenant_id: 'seed-tenant-1',
        ...overrides,
    });
    return repo.save(guardian);
}
/**
 * Creates a test fee structure in the database.
 */
async function seedFeeStructure(dataSource, overrides = {}) {
    const repo = dataSource.getRepository('FeeStructure');
    const feeStructure = repo.create({
        fee_type: 'MONTHLY_TUITION',
        name: 'Monthly Tuition Fee',
        amount: 1000,
        applicability: 'ALL',
        class_id: 'seed-class-1',
        academic_year_id: 'seed-ay-1',
        month: 1,
        is_recurring: true,
        tenant_id: 'seed-tenant-1',
        ...overrides,
    });
    return repo.save(feeStructure);
}
/**
 * Creates a test academic year in the database.
 */
async function seedAcademicYear(dataSource, overrides = {}) {
    const repo = dataSource.getRepository('AcademicYear');
    const academicYear = repo.create({
        name: '2027-2028',
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        is_current: false,
        tenant_id: 'seed-tenant-1',
        ...overrides,
    });
    return repo.save(academicYear);
}
/**
 * Creates a test payment in the database.
 */
async function seedPayment(dataSource, overrides = {}) {
    const repo = dataSource.getRepository('Payment');
    const payment = repo.create({
        student_id: overrides.student_id || 'placeholder',
        total_amount: 500,
        payment_method: 'CASH',
        payment_status: 'SUCCESS',
        tenant_id: 'seed-tenant-1',
        ...overrides,
    });
    return repo.save(payment);
}
//# sourceMappingURL=db.helper.js.map