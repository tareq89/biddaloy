import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DocumentKind } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { StudentLifecycleService } from '../../students/student-lifecycle.service';
import { EnrollmentService } from '../../enrollments/enrollments.service';
import { AuditService } from '../../audit/audit.service';
import { StudentCertificateResolver } from './student-certificate.resolver';

const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };
const TENANT_B = '48140000-0000-4000-8000-0000000000b0';

describe('StudentCertificateResolver (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let lifecycle: StudentLifecycleService;
  let n = 0;
  const tc = new StudentCertificateResolver(DocumentKind.TRANSFER_CERTIFICATE);

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      StudentLifecycleService,
      EnrollmentService,
      AuditService,
    ]);
    ds = module.get(DataSource);
    lifecycle = module.get(StudentLifecycleService);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, 'School B', 'cert-school-b', NOW(), NOW())`,
      [TENANT_B],
    );
  });

  afterAll(async () => {
    if (!ds) return;
    await ds.query(`DELETE FROM students WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await module.close();
  });

  /** The global beforeEach wipes students, so seed inside each test. */
  async function seedStudent() {
    n += 1;
    const [s] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`Cert ${n}`, `CERT-${n}`, n, SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [s.id, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    return s.id as string;
  }
  const leave = (id: string) =>
    lifecycle.leave(
      id,
      {
        type: 'TRANSFERRED_OUT',
        occurred_on: '2026-03-01',
        reason: 'moved',
        destination: 'Ideal School',
      },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
      CTX,
    );

  it('TC after leave(TRANSFERRED_OUT) carries the destination and the class at leaving', async () => {
    const id = await seedStudent();
    await leave(id);
    const out = await tc.resolve(SEED_TENANT_ID, [id], ds.manager);
    const v = out.get(id)!.values;
    expect(v['leaving.destination']).toBe('Ideal School');
    expect(v['leaving.date']).toBe('2026-03-01');
    expect(v['leaving.class']).not.toBe('');
  });

  it('TC is refused after readmit (D4)', async () => {
    const id = await seedStudent();
    await leave(id);
    await lifecycle.readmit(
      id,
      { occurred_on: '2026-04-01', class_section_id: SEED_SECTION_1_ID },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
      CTX,
    );
    await expect(tc.resolve(SEED_TENANT_ID, [id], ds.manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a student of another tenant is not returned', async () => {
    const id = await seedStudent();
    const out = await new StudentCertificateResolver(DocumentKind.CHARACTER_CERTIFICATE).resolve(
      TENANT_B,
      [id],
      ds.manager,
    );
    expect(out.size).toBe(0);
  });

  it('school.eiin equals the school registration id', async () => {
    const id = await seedStudent();
    await ds.query(`UPDATE schools SET registration_id = '108765' WHERE id = $1`, [SEED_TENANT_ID]);
    const out = await new StudentCertificateResolver(DocumentKind.CHARACTER_CERTIFICATE).resolve(
      SEED_TENANT_ID,
      [id],
      ds.manager,
    );
    expect(out.get(id)!.values['school.eiin']).toBe('108765');
  });
});
