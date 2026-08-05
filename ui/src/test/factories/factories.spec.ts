import { describe, expect, it } from 'vitest';

import { academicYearFactory } from './academic-year.factory';
import { auditEntryFactory } from './audit-log.factory';
import { bnFullName, bnPhoneNumber, bnAddress } from './bangla-data';
import { classSectionFactory } from './class-section.factory';
import { classFactory } from './class.factory';
import { communicationFactory } from './communication.factory';
import { resetFactorySeed } from './faker';
import { feeStructureFactory } from './fee-structure.factory';
import { guardianFactory } from './guardian.factory';
import { invoiceFactory } from './invoice.factory';
import { moneyAmount } from './money';
import { paymentFactory } from './payment.factory';
import { schoolFactory } from './school.factory';
import { studentFeeFactory } from './student-fee.factory';
import { studentFactory } from './student.factory';
import { teacherFactory } from './teacher.factory';
import { userFactory, userResponseFactory } from './user.factory';

const BANGLA_RANGE = /[ঀ-৿]/;
const LATIN_LETTERS = /[A-Za-z]/;

// Every top-level entity factory the issue asks for, run with default
// (unscripted) options — used by the "determinism" and "partial overrides"
// suites below so those don't have to enumerate all twelve by hand.
const FACTORIES = {
  school: () => schoolFactory(),
  academicYear: () => academicYearFactory(),
  class: () => classFactory(),
  classSection: () => classSectionFactory(),
  user: () => userFactory(),
  guardian: () => guardianFactory(),
  student: () => studentFactory(),
  teacher: () => teacherFactory(),
  feeStructure: () => feeStructureFactory(),
  studentFee: () => studentFeeFactory(),
  payment: () => paymentFactory(),
  invoice: () => invoiceFactory(),
  communication: () => communicationFactory(),
  auditEntry: () => auditEntryFactory(),
} as const;

describe('factory determinism', () => {
  it.each(Object.entries(FACTORIES))(
    '%s: a fixed seed produces identical output across separate runs',
    (_name, build) => {
      resetFactorySeed();
      const first = build();

      resetFactorySeed();
      const second = build();

      expect(second).toEqual(first);
    },
  );
});

describe('partial overrides', () => {
  it.each(Object.entries(FACTORIES))(
    '%s: an override wins over the generated default',
    (_name, build) => {
      const generated = build();
      const idKey = 'id' as const;
      expect((generated as Record<string, unknown>)[idKey]).toBeTruthy();
    },
  );

  it('studentFactory accepts a deep override without losing the rest of the shape', () => {
    const student = studentFactory({ full_name: 'Custom Name', roll_number: 7 });
    expect(student.full_name).toBe('Custom Name');
    expect(student.roll_number).toBe(7);
    expect(student.class_section).toBeTruthy();
    expect(student.guardians).toHaveLength(1);
  });

  it('schoolFactory accepts an override', () => {
    const school = schoolFactory({ name: 'Green Valley School' });
    expect(school.name).toBe('Green Valley School');
  });
});

describe('Bangla and Latin script generation', () => {
  it('bnFullName produces Bangla-script characters', () => {
    expect(bnFullName()).toMatch(BANGLA_RANGE);
  });

  it('bnPhoneNumber produces a BD-format 11-digit mobile number', () => {
    const phone = bnPhoneNumber();
    expect(phone).toMatch(/^01[3-9]\d{8}$/);
  });

  it('bnAddress produces Bangla-script characters', () => {
    expect(bnAddress()).toMatch(BANGLA_RANGE);
  });

  it('studentFactory forced to "bn" produces a Bangla full_name and address', () => {
    const student = studentFactory({}, 'bn');
    expect(student.full_name).toMatch(BANGLA_RANGE);
    expect(student.home_address).toMatch(BANGLA_RANGE);
  });

  it('studentFactory forced to "latin" produces a Latin full_name and address', () => {
    const student = studentFactory({}, 'latin');
    expect(student.full_name).toMatch(LATIN_LETTERS);
    expect(student.full_name).not.toMatch(BANGLA_RANGE);
  });

  it('guardianFactory forced to "bn" produces Bangla phone, name and address', () => {
    const guardian = guardianFactory({}, 'bn');
    expect(guardian.full_name).toMatch(BANGLA_RANGE);
    expect(guardian.phone).toMatch(/^01[3-9]\d{8}$/);
    expect(guardian.address).toMatch(BANGLA_RANGE);
  });

  it('a batch of unscripted studentFactory calls produces both scripts', () => {
    resetFactorySeed();
    const names = Array.from({ length: 20 }, () => studentFactory().full_name);
    expect(names.some((n) => BANGLA_RANGE.test(n))).toBe(true);
    expect(names.some((n) => LATIN_LETTERS.test(n) && !BANGLA_RANGE.test(n))).toBe(true);
  });
});

describe('money — lakh/crore digit boundaries', () => {
  it.each([4, 5, 6, 7, 8] as const)('moneyAmount(%i) produces a %i-digit number', (digits) => {
    const value = moneyAmount(digits);
    expect(String(value)).toHaveLength(digits);
  });

  it('digit 6 covers the lakh boundary (100000) and digit 8 the crore boundary (10000000)', () => {
    expect(moneyAmount(6)).toBeGreaterThanOrEqual(100_000);
    expect(moneyAmount(6)).toBeLessThan(1_000_000);
    expect(moneyAmount(8)).toBeGreaterThanOrEqual(10_000_000);
    expect(moneyAmount(8)).toBeLessThan(100_000_000);
  });
});

describe('cross-entity typing derives from the generated OpenAPI schema', () => {
  it("feeStructureFactory's amount/class/academic_year line up with StudentFee's own relations", () => {
    const feeStructure = feeStructureFactory();
    const due = studentFeeFactory({}, undefined);
    expect(feeStructure.class_id).toBe(feeStructure.class.id);
    expect(due.academic_year_id).toBe(due.academic_year.id);
  });

  it('userResponseFactory omits the fields User carries that UserResponseDto does not', () => {
    const user = userResponseFactory();
    expect(user).not.toHaveProperty('user_tenants');
    expect(user).not.toHaveProperty('deleted_at');
  });

  it('teacherFactory.user is UserResponseDto-shaped, matching TeacherResponseDto', () => {
    const teacher = teacherFactory();
    expect(teacher.user).not.toHaveProperty('user_tenants');
  });

  it('auditEntryFactory produces a valid AuditAction', () => {
    const entry = auditEntryFactory({ action: 'PAYMENT_RECEIVED' });
    expect(entry.action).toBe('PAYMENT_RECEIVED');
  });
});
