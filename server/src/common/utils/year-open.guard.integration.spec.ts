import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { assertDateNotInClosedYear, assertYearOpen } from './year-open.guard';

// Needs Postgres: the guard is one SQL query, so it is tested against the real table.
describe('year-open guard', () => {
  let module: TestingModule;
  let ds: DataSource;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();

  async function addYear(name: string, start: string, end: string, closed: boolean) {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO academic_years (id, tenant_id, name, start_date, end_date, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, tenantId, name, start, end, closed ? new Date() : null],
    );
    return id;
  }

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    for (const id of [tenantId, otherTenantId]) {
      await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
        id,
        'Year Guard School',
        `year-guard-${id.slice(0, 8)}`,
      ]);
    }
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  it('lets an open year pass', async () => {
    const id = await addYear('open-1', '2031-01-01', '2031-12-31', false);
    await expect(assertYearOpen(ds.manager, tenantId, id)).resolves.toBeUndefined();
  });

  it('refuses a closed year with 409 ACADEMIC_YEAR_CLOSED and the fixed sentence', async () => {
    const id = await addYear('closed-1', '2032-01-01', '2032-12-31', true);
    const err = await assertYearOpen(ds.manager, tenantId, id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'This academic year is closed. Reopen it on Academic years to change this.',
      details: { code: 'ACADEMIC_YEAR_CLOSED' },
    });
  });

  it('answers 404 for an unknown year, and for another school’s year (tenant isolation)', async () => {
    await expect(assertYearOpen(ds.manager, tenantId, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const id = await addYear('mine-1', '2033-01-01', '2033-12-31', false);
    await expect(assertYearOpen(ds.manager, otherTenantId, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a date inside a closed year, passes a date outside it', async () => {
    await addYear('closed-2', '2034-01-01', '2034-12-31', true);
    await expect(
      assertDateNotInClosedYear(ds.manager, tenantId, '2034-06-15'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      assertDateNotInClosedYear(ds.manager, tenantId, '2035-06-15'),
    ).resolves.toBeUndefined();
  });

  it('refuses a date covered by a closed AND an open overlapping year (D12)', async () => {
    await addYear('closed-3', '2036-01-01', '2036-12-31', true);
    await addYear('open-3', '2036-07-01', '2037-06-30', false);
    await expect(
      assertDateNotInClosedYear(ds.manager, tenantId, '2036-09-01'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
