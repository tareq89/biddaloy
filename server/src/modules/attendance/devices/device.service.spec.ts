import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { AttendanceDeviceKind, AttendanceDeviceStatus, AuditAction } from '@biddaloy/shared';
import { DeviceService, hashDeviceKey } from './device.service';

function fakeAuditService() {
  return { record: vi.fn().mockResolvedValue(undefined) } as any;
}

function fakeDeviceRepo(overrides: Partial<Record<string, any>> = {}) {
  return {
    create: vi.fn((v) => v),
    save: vi.fn(async (v) => ({ id: 'device-1', created_at: new Date(), ...v })),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

describe('hashDeviceKey', () => {
  it('is the SHA-256 hex digest of the exact string passed in', () => {
    const raw = 'bd_dev_abc123';
    expect(hashDeviceKey(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
  });
});

describe('DeviceService.create', () => {
  it('generates a key that is prefixed and at least 40 characters', async () => {
    const deviceRepo = fakeDeviceRepo();
    const service = new DeviceService(deviceRepo, fakeAuditService());

    const result = await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      dto: { name: 'Gate Scanner', kind: AttendanceDeviceKind.RFID },
      ip: '127.0.0.1',
      userAgent: 'test',
    });

    expect(result.key.startsWith('bd_dev_')).toBe(true);
    expect(result.key.length).toBeGreaterThanOrEqual(40);
  });

  it('stores the SHA-256 hash of the prefixed key, not the raw key', async () => {
    const deviceRepo = fakeDeviceRepo();
    const service = new DeviceService(deviceRepo, fakeAuditService());

    const result = await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      dto: { name: 'Gate Scanner', kind: AttendanceDeviceKind.RFID },
      ip: null,
      userAgent: null,
    });

    const saved = await deviceRepo.save.mock.results[0].value;
    expect(saved.token_hash).toBe(hashDeviceKey(result.key));
  });

  it('never returns the raw key or its hash on the response entity', async () => {
    const deviceRepo = fakeDeviceRepo();
    const service = new DeviceService(deviceRepo, fakeAuditService());

    const result = await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      dto: { name: 'Gate Scanner', kind: AttendanceDeviceKind.RFID },
      ip: null,
      userAgent: null,
    });

    expect(result.device).not.toHaveProperty('token_hash');
    expect(JSON.stringify(result.device)).not.toContain(result.key);
  });

  it('audits creation without ever including the key or its hash', async () => {
    const deviceRepo = fakeDeviceRepo();
    const auditService = fakeAuditService();
    const service = new DeviceService(deviceRepo, auditService);

    await service.create({
      tenantId: 'tenant-1',
      userId: 'user-1',
      dto: { name: 'Gate Scanner', kind: AttendanceDeviceKind.RFID },
      ip: '127.0.0.1',
      userAgent: 'test',
    });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CREATE, entity_type: 'AttendanceDevice' }),
    );
    const [entry] = auditService.record.mock.calls[0];
    expect(JSON.stringify(entry)).not.toMatch(/bd_dev_/);
  });
});

describe('DeviceService.rotate', () => {
  it('overwrites the old hash immediately — no grace period', async () => {
    const existingDevice = {
      id: 'device-1',
      tenant_id: 'tenant-1',
      token_hash: 'old-hash',
      token_last4: 'aaaa',
      status: AttendanceDeviceStatus.ACTIVE,
    };
    const deviceRepo = fakeDeviceRepo({
      findOne: vi.fn().mockResolvedValue(existingDevice),
      save: vi.fn(async (v) => v),
    });
    const service = new DeviceService(deviceRepo, fakeAuditService());

    const result = await service.rotate({
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      userId: 'user-1',
      ip: null,
      userAgent: null,
    });

    expect(existingDevice.token_hash).not.toBe('old-hash');
    expect(existingDevice.token_hash).toBe(hashDeviceKey(result.key));
  });

  it("throws NotFoundException for a device outside the caller's tenant", async () => {
    const deviceRepo = fakeDeviceRepo({ findOne: vi.fn().mockResolvedValue(null) });
    const service = new DeviceService(deviceRepo, fakeAuditService());

    await expect(
      service.rotate({
        tenantId: 'tenant-1',
        deviceId: 'device-x',
        userId: 'u',
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow('Device not found');
  });
});

describe('DeviceService.revoke', () => {
  it('sets status to REVOKED rather than deleting the row', async () => {
    const existingDevice = {
      id: 'device-1',
      tenant_id: 'tenant-1',
      status: AttendanceDeviceStatus.ACTIVE,
      revoked_at: null,
    };
    const deviceRepo = fakeDeviceRepo({
      findOne: vi.fn().mockResolvedValue(existingDevice),
      save: vi.fn(async (v) => v),
    });
    const service = new DeviceService(deviceRepo, fakeAuditService());

    await service.revoke({
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      userId: 'u',
      ip: null,
      userAgent: null,
    });

    expect(existingDevice.status).toBe(AttendanceDeviceStatus.REVOKED);
    expect(existingDevice.revoked_at).not.toBeNull();
  });
});

describe('DeviceService.list', () => {
  it('never includes token_hash in the response shape', async () => {
    const deviceRepo = fakeDeviceRepo({
      find: vi.fn().mockResolvedValue([
        {
          id: 'device-1',
          name: 'Gate',
          kind: AttendanceDeviceKind.RFID,
          token_hash: 'secret-hash',
          token_last4: 'aaaa',
          section_id: null,
          roster_access: false,
          status: AttendanceDeviceStatus.ACTIVE,
          last_seen_at: null,
        },
      ]),
    });
    const service = new DeviceService(deviceRepo, fakeAuditService());

    const result = await service.list('tenant-1');

    expect(result[0]).not.toHaveProperty('token_hash');
  });
});
