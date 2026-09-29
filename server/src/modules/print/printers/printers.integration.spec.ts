import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { PrintersService } from './printers.service';
import { AuditService } from '../../audit/audit.service';

/** [32.2.x] Printer profile CRUD against real Postgres (migrated schema, so the unique-name index exists). */
describe('PrintersService (integration)', () => {
  let ds: DataSource;
  let service: PrintersService;
  let userId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [PrintersService, AuditService]);
    ds = module.get(DataSource);
    service = module.get(PrintersService);
    userId = (await ds.query(`SELECT id FROM users LIMIT 1`))[0].id;
    otherTenantId = (
      await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
        `Other ${randomUUID()}`,
        `other-${randomUUID()}`,
      ])
    )[0].id;
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM printer_profiles WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      otherTenantId,
    ]);
    // The school stays: audit_logs is append-only and FK-references it.
    await ds.destroy();
  });

  it('round-trips create -> list -> update -> archive with numeric types and audit rows', async () => {
    const created = await service.create(SEED_TENANT_ID, userId, {
      name: 'Office A',
      printer_type: 'OFFICE',
    });
    // Acceptance: OFFICE with no margins comes back with 5 mm.
    expect(created.margin_top_mm).toBe(5);
    expect(created.scale).toBe(1);
    expect(created.sheet_gap_mm).toBe(2);

    const [listed] = await service.list(SEED_TENANT_ID);
    expect(listed.id).toBe(created.id);
    expect(typeof listed.offset_x_mm).toBe('number');

    const updated = await service.update(SEED_TENANT_ID, userId, created.id, {
      scale: 1.05,
      offset_x_mm: -2.5,
    });
    expect(updated.scale).toBe(1.05);
    expect(updated.offset_x_mm).toBe(-2.5);

    await service.archive(SEED_TENANT_ID, userId, created.id);
    expect(await service.list(SEED_TENANT_ID)).toEqual([]);

    // Every write leaves an audit row: create, update, archive.
    const audits = await ds.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'PrinterProfile' AND entity_id = $1`,
      [created.id],
    );
    expect(audits).toHaveLength(3);
  });

  it('rejects a duplicate active name (case-insensitive) with 409, but allows it once archived', async () => {
    const a = await service.create(SEED_TENANT_ID, userId, { name: 'Dup', printer_type: 'CARD' });
    await expect(
      service.create(SEED_TENANT_ID, userId, { name: 'dup', printer_type: 'CARD' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.archive(SEED_TENANT_ID, userId, a.id);
    await expect(
      service.create(SEED_TENANT_ID, userId, { name: 'Dup', printer_type: 'CARD' }),
    ).resolves.toBeDefined();
  });

  it('isolates tenants: another tenant gets 404 and an empty list', async () => {
    const p = await service.create(SEED_TENANT_ID, userId, { name: 'Mine', printer_type: 'CARD' });
    expect(await service.list(otherTenantId)).toEqual([]);
    await expect(service.update(otherTenantId, userId, p.id, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.archive(otherTenantId, userId, p.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // The same name in another tenant is fine.
    await expect(
      service.create(otherTenantId, userId, { name: 'Mine', printer_type: 'CARD' }),
    ).resolves.toBeDefined();
  });
});
