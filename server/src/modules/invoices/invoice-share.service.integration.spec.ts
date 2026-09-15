import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoiceShareService } from './invoice-share.service';
import { InvoiceShareToken } from './entities/invoice-share-token.entity';
import { Invoice } from './entities/invoice.entity';
import { Student } from '../students/entities/student.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { InvoiceKind, InvoiceStatus } from '@biddaloy/shared';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

/**
 * Integration tests for `InvoiceShareService` [#666]. Covers the security
 * property the whole design hinges on (raw token never persisted, only a
 * SHA-256 hash of it), revoke making a token permanently invalid, and the
 * view counters `validatePublicToken` bumps on success.
 */
describe('InvoiceShareService (integration)', () => {
  let service: InvoiceShareService;
  let tokenRepo: Repository<InvoiceShareToken>;
  let invoiceRepo: Repository<Invoice>;
  let studentRepo: Repository<Student>;
  let dataSource: DataSource;
  let invoiceId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [InvoiceShareService, AuditService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<InvoiceShareService>(InvoiceShareService);
    tokenRepo = module.get<Repository<InvoiceShareToken>>(getRepositoryToken(InvoiceShareToken));
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    dataSource = module.get(DataSource);

    await dataSource
      .getRepository(School)
      .save(
        dataSource
          .getRepository(School)
          .create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
      );
    await dataSource
      .getRepository(School)
      .save(
        dataSource
          .getRepository(School)
          .create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
      );
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: SEED_ADMIN_USER_ID,
        email: SEED_ADMIN_EMAIL,
        password_hash: SEED_ADMIN_PASSWORD_HASH,
        full_name: 'Test Admin',
      }),
    );
    await dataSource.getRepository(AcademicYear).save(
      dataSource.getRepository(AcademicYear).create({
        id: SEED_ACADEMIC_YEAR_ID,
        name: '2026-2027',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await dataSource.getRepository(Class).save(
      dataSource.getRepository(Class).create({
        id: SEED_CLASS_1_ID,
        name: 'Class One',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await dataSource.getRepository(ClassSection).save(
      dataSource.getRepository(ClassSection).create({
        id: SEED_SECTION_1_ID,
        section_name: 'Section A',
        class_id: SEED_CLASS_1_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM invoice_share_tokens');
    await dataSource.query('DELETE FROM invoices');
    await dataSource.query('DELETE FROM students');

    const student = await studentRepo.save(
      studentRepo.create({
        full_name: 'Student One',
        registration_number: 'REG-SHARE-0001',
        roll_number: 1,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: SEED_TENANT_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: 'SMS' as any,
      }),
    );
    const invoice = await invoiceRepo.save(
      invoiceRepo.create({
        invoice_number: 'INV-2026-00001',
        kind: InvoiceKind.INVOICE,
        student_id: student.id,
        total_amount: 1000,
        status: InvoiceStatus.ISSUED,
        issued_date: new Date(),
        due_date: new Date(),
        snapshot: {
          issuer: {},
          students: [],
          totals: { billed: 0, discount: 0, paid: 0, change: 0, wallet_used: 0, wallet_added: 0 },
          payment: {
            method: 'CASH',
            reference: null,
            received_by_name: null,
            payment_date: new Date().toISOString(),
          },
        },
      }),
    );
    invoiceId = invoice.id;
  });

  it('stores only a SHA-256 hash — the raw token never appears in the DB row', async () => {
    const { rawToken, tokenId } = await service.createToken(
      invoiceId,
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const row = await tokenRepo.findOneOrFail({ where: { id: tokenId } });
    expect(row.token_hash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(row.token_hash).not.toBe(rawToken);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });

  it("rejects minting a share token for another tenant's invoice (tenant isolation)", async () => {
    await expect(
      service.createToken(invoiceId, OTHER_TENANT_ID, SEED_ADMIN_USER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an unknown token id/tenant on revoke', async () => {
    await expect(
      service.revokeToken(
        '00000000-0000-4000-8000-000000000001',
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('a revoked token fails validatePublicToken (not-found, not distinguished from unknown)', async () => {
    const { rawToken, tokenId } = await service.createToken(
      invoiceId,
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(await service.validatePublicToken(rawToken)).not.toBeNull();

    await service.revokeToken(tokenId, SEED_TENANT_ID, SEED_ADMIN_USER_ID);

    expect(await service.validatePublicToken(rawToken)).toBeNull();
  });

  it('an unknown raw token is rejected', async () => {
    expect(await service.validatePublicToken('not-a-real-token')).toBeNull();
  });

  it('a valid view bumps view_count and sets last_viewed_at', async () => {
    const { rawToken, tokenId } = await service.createToken(
      invoiceId,
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    const before = await tokenRepo.findOneOrFail({ where: { id: tokenId } });
    expect(before.view_count).toBe(0);
    expect(before.last_viewed_at).toBeNull();

    await service.validatePublicToken(rawToken);
    await service.validatePublicToken(rawToken);

    const after = await tokenRepo.findOneOrFail({ where: { id: tokenId } });
    expect(after.view_count).toBe(2);
    expect(after.last_viewed_at).not.toBeNull();
  });

  it('lists tokens for an invoice without exposing token_hash', async () => {
    await service.createToken(invoiceId, SEED_TENANT_ID, SEED_ADMIN_USER_ID);
    const list = await service.listTokens(invoiceId, SEED_TENANT_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('token_hash');
  });

  it('a token scoped to another tenant is not returned by listTokens', async () => {
    await service.createToken(invoiceId, SEED_TENANT_ID, SEED_ADMIN_USER_ID);
    const list = await service.listTokens(invoiceId, OTHER_TENANT_ID);
    expect(list).toHaveLength(0);
  });
});
