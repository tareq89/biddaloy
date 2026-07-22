import { DataSource } from 'typeorm';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '../constants';

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
export async function clearTables(): Promise<void> {
  const { clearTransactionalTables } = await import('../setup.js');
  await clearTransactionalTables();
}

/**
 * Creates a test student in the database.
 */
export async function seedStudent(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    full_name: string;
    registration_number: string;
    roll_number: number;
    class_section_id: string;
    tenant_id: string;
    date_of_birth: string;
    gender: string;
    enrollment_status: string;
  }> = {},
): Promise<any> {
  const repo = dataSource.getRepository('Student');
  const student = repo.create({
    full_name: 'Test Student',
    registration_number: 'REG-2026-0001',
    roll_number: 1,
    class_section_id: SEED_SECTION_1_ID,
    tenant_id: SEED_TENANT_ID,
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
export async function seedGuardian(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    full_name: string;
    relationship: string;
    phone: string;
    email: string;
    tenant_id: string;
  }> = {},
): Promise<any> {
  const repo = dataSource.getRepository('Guardian');
  const guardian = repo.create({
    full_name: 'Test Guardian',
    relationship: 'FATHER',
    phone: '+880****0001',
    email: 'guardian@test.com',
    tenant_id: SEED_TENANT_ID,
    ...overrides,
  });
  return repo.save(guardian);
}

/**
 * Creates a test fee structure in the database.
 */
export async function seedFeeStructure(
  dataSource: DataSource,
  overrides: Partial<{
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
  }> = {},
): Promise<any> {
  const repo = dataSource.getRepository('FeeStructure');
  const feeStructure = repo.create({
    fee_type: 'MONTHLY_TUITION',
    name: 'Monthly Tuition Fee',
    amount: 1000,
    applicability: 'ALL',
    class_id: SEED_CLASS_1_ID,
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
    month: 1,
    is_recurring: true,
    tenant_id: SEED_TENANT_ID,
    ...overrides,
  });
  return repo.save(feeStructure);
}

/**
 * Creates a test academic year in the database.
 */
export async function seedAcademicYear(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
    tenant_id: string;
  }> = {},
): Promise<any> {
  const repo = dataSource.getRepository('AcademicYear');
  const academicYear = repo.create({
    name: '2027-2028',
    start_date: '2027-01-01',
    end_date: '2027-12-31',
    is_current: false,
    tenant_id: SEED_TENANT_ID,
    ...overrides,
  });
  return repo.save(academicYear);
}

/**
 * Creates a test payment in the database.
 */
export async function seedPayment(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    student_id: string;
    total_amount: number;
    payment_method: string;
    payment_status: string;
    tenant_id: string;
  }> = {},
): Promise<any> {
  const repo = dataSource.getRepository('Payment');
  const payment = repo.create({
    student_id: overrides.student_id || 'placeholder',
    total_amount: 500,
    payment_method: 'CASH',
    payment_status: 'SUCCESS',
    tenant_id: SEED_TENANT_ID,
    ...overrides,
  });
  return repo.save(payment);
}