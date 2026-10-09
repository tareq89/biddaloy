import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { AuditAction, Permission } from '@biddaloy/shared';
import { PrintersService } from './printers.service';
import { PrintersController } from './printers.controller';
import { CreatePrinterProfileDto } from './dto/printer-profile.dto';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';

const TENANT = 'tenant-1';
const USER = 'user-1';

/** A row as pg returns it: numeric columns are strings. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    tenant_id: TENANT,
    name: 'Front desk',
    printer_type: 'OFFICE',
    margin_top_mm: '5.00',
    margin_right_mm: '5.00',
    margin_bottom_mm: '5.00',
    margin_left_mm: '5.00',
    offset_x_mm: '0.00',
    offset_y_mm: '0.00',
    scale: '1.0000',
    duplex_order: 'INTERLEAVED',
    sheet_gap_mm: '2.00',
    archived_at: null,
    ...overrides,
  };
}

describe('PrintersService', () => {
  let repo: { find: any; findOne: any; create: any; save: any };
  let audit: { record: any };
  let service: PrintersService;

  beforeEach(() => {
    repo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(),
      create: vi.fn((x) => ({ id: 'p-1', archived_at: null, ...x })),
      save: vi.fn(async (x) => x),
    };
    audit = { record: vi.fn(async () => undefined) };
    service = new PrintersService(repo as any, audit as any);
  });

  it('gives an OFFICE profile 5 mm margins when none are sent', async () => {
    const out = await service.create(TENANT, USER, { name: 'A', printer_type: 'OFFICE' });
    expect([
      out.margin_top_mm,
      out.margin_right_mm,
      out.margin_bottom_mm,
      out.margin_left_mm,
    ]).toEqual([5, 5, 5, 5]);
  });

  it('gives a CARD profile 0 mm margins, and explicit margins win over the default', async () => {
    const card = await service.create(TENANT, USER, { name: 'C', printer_type: 'CARD' });
    expect(card.margin_left_mm).toBe(0);
    const custom = await service.create(TENANT, USER, {
      name: 'O',
      printer_type: 'OFFICE',
      margin_left_mm: 8,
    });
    expect(custom.margin_left_mm).toBe(8);
    expect(custom.margin_top_mm).toBe(5);
  });

  it('returns numeric columns as numbers, not strings', async () => {
    repo.find.mockResolvedValue([row({ scale: '1.0500', offset_x_mm: '-3.50' })]);
    const [p] = await service.list(TENANT);
    expect(p.scale).toBe(1.05);
    expect(p.offset_x_mm).toBe(-3.5);
    expect(typeof p.sheet_gap_mm).toBe('number');
  });

  it('list is tenant-scoped, non-archived and sorted by name', async () => {
    await service.list(TENANT);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.tenant_id).toBe(TENANT);
    expect(arg.where.archived_at).toBeDefined();
    expect(arg.order).toEqual({ name: 'ASC' });
  });

  it('turns a unique-name violation into 409', async () => {
    repo.save.mockRejectedValue(
      new QueryFailedError('insert', [], Object.assign(new Error('dup'), { code: '23505' })),
    );
    await expect(
      service.create(TENANT, USER, { name: 'A', printer_type: 'CARD' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('archive sets archived_at, audits it, and a missing row is 404', async () => {
    repo.findOne.mockResolvedValueOnce(row());
    const out = await service.archive(TENANT, USER, 'p-1');
    expect(out.archived_at).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.UPDATE, entity_type: 'PrinterProfile' }),
    );
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.archive(TENANT, USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create and update each write an audit row naming the manager', async () => {
    await service.create(TENANT, USER, { name: 'A', printer_type: 'CARD' });
    repo.findOne.mockResolvedValueOnce(row());
    await service.update(TENANT, USER, 'p-1', { name: 'B' });
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: AuditAction.CREATE,
      performed_by_user_id: USER,
      tenant_id: TENANT,
    });
    expect(audit.record.mock.calls[1][0].action).toBe(AuditAction.UPDATE);
  });
});

describe('CreatePrinterProfileDto validation', () => {
  const check = async (body: Record<string, unknown>) =>
    validate(
      plainToInstance(CreatePrinterProfileDto, { name: 'A', printer_type: 'CARD', ...body }),
    );

  it('accepts a minimal body', async () => {
    expect(await check({})).toHaveLength(0);
  });

  it.each([
    ['name too long', { name: 'x'.repeat(81) }],
    ['empty name', { name: '' }],
    ['bad type', { printer_type: 'LASER' }],
    ['margin > 25', { margin_top_mm: 26 }],
    ['negative margin', { margin_left_mm: -1 }],
    ['offset < -10', { offset_x_mm: -10.5 }],
    ['offset > 10', { offset_y_mm: 11 }],
    ['scale < 0.9', { scale: 0.89 }],
    ['scale > 1.1', { scale: 1.11 }],
    ['bad duplex', { duplex_order: 'SIDEWAYS' }],
    ['gap > 10', { sheet_gap_mm: 10.5 }],
  ])('rejects %s', async (_label, body) => {
    expect((await check(body)).length).toBeGreaterThan(0);
  });
});

describe('PrintersController permissions', () => {
  const reflector = new Reflector();
  const perm = (method: keyof PrintersController) =>
    reflector.get(PERMISSIONS_KEY, PrintersController.prototype[method]);

  it('read needs DOCUMENT_PRINT; writes need PRINT_TEMPLATE_MANAGE', () => {
    expect(perm('list')).toEqual([Permission.DOCUMENT_PRINT]);
    for (const m of ['create', 'update', 'archive'] as const) {
      expect(perm(m)).toEqual([Permission.PRINT_TEMPLATE_MANAGE]);
    }
  });
});
