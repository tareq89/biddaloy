import { DataSource } from 'typeorm';
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
export declare function clearTables(): Promise<void>;
/**
 * Creates a test student in the database.
 */
export declare function seedStudent(dataSource: DataSource, overrides?: Partial<{
    id: string;
    full_name: string;
    registration_number: string;
    roll_number: number;
    class_section_id: string;
    tenant_id: string;
    date_of_birth: string;
    gender: string;
    enrollment_status: string;
}>): Promise<any>;
/**
 * Creates a test guardian in the database.
 */
export declare function seedGuardian(dataSource: DataSource, overrides?: Partial<{
    id: string;
    full_name: string;
    relationship: string;
    phone: string;
    email: string;
    tenant_id: string;
}>): Promise<any>;
/**
 * Creates a test fee structure in the database.
 */
export declare function seedFeeStructure(dataSource: DataSource, overrides?: Partial<{
    id: string;
    fee_type: string;
    name: string;
    amount: number;
    applicability: string;
    class_id: string;
    academic_year_id: string;
    month: number;
    is_recurring: boolean;
    tenant_id: string;
}>): Promise<any>;
/**
 * Creates a test academic year in the database.
 */
export declare function seedAcademicYear(dataSource: DataSource, overrides?: Partial<{
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
    tenant_id: string;
}>): Promise<any>;
/**
 * Creates a test payment in the database.
 */
export declare function seedPayment(dataSource: DataSource, overrides?: Partial<{
    id: string;
    student_id: string;
    total_amount: number;
    payment_method: string;
    payment_status: string;
    tenant_id: string;
}>): Promise<any>;
//# sourceMappingURL=db.helper.d.ts.map