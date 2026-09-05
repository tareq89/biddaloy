import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AttendanceDeviceStatus } from '@biddaloy/shared';
import { DeviceAuthGuard } from './device-auth.guard';
import { hashDeviceKey } from './device.service';

function fakeContext(headers: Record<string, string>) {
  const request: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

function fakeRepo(device: any | null) {
  return { findOne: vi.fn().mockResolvedValue(device) } as any;
}

describe('DeviceAuthGuard', () => {
  it('rejects with "Device key required" when the header is missing', async () => {
    const guard = new DeviceAuthGuard(fakeRepo(null));
    await expect(guard.canActivate(fakeContext({}))).rejects.toThrow(
      new UnauthorizedException('Device key required'),
    );
  });

  it('rejects with "Device key required" when the header is too short', async () => {
    const guard = new DeviceAuthGuard(fakeRepo(null));
    await expect(guard.canActivate(fakeContext({ 'x-device-key': 'short' }))).rejects.toThrow(
      new UnauthorizedException('Device key required'),
    );
  });

  it('rejects an unknown key with "Invalid device key" — same message as a missing device', async () => {
    const repo = fakeRepo(null);
    const guard = new DeviceAuthGuard(repo);
    const rawKey = 'bd_dev_00000000000000000000000000000000';

    await expect(guard.canActivate(fakeContext({ 'x-device-key': rawKey }))).rejects.toThrow(
      new UnauthorizedException('Invalid device key'),
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { token_hash: hashDeviceKey(rawKey), status: AttendanceDeviceStatus.ACTIVE },
    });
  });

  it('rejects a revoked key the same way an unknown key is rejected', async () => {
    // A revoked device's row is filtered out by `status: ACTIVE` in the
    // query itself, so the repo returning null covers this case too — the
    // guard cannot distinguish "unknown" from "revoked", which is the
    // point (no oracle for which keys exist).
    const repo = fakeRepo(null);
    const guard = new DeviceAuthGuard(repo);

    await expect(
      guard.canActivate(fakeContext({ 'x-device-key': 'bd_dev_revoked_key_00000000000000' })),
    ).rejects.toThrow(new UnauthorizedException('Invalid device key'));
  });

  it('sets currentDevice and currentTenant from the device row on a valid key, ignoring X-Tenant-ID', async () => {
    const device = {
      id: 'device-1',
      tenant_id: 'tenant-1',
      status: AttendanceDeviceStatus.ACTIVE,
    };
    const repo = fakeRepo(device);
    const guard = new DeviceAuthGuard(repo);
    const request: any = {
      headers: {
        'x-device-key': 'bd_dev_valid_key_000000000000000',
        'x-tenant-id': 'tenant-attacker',
      },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.currentDevice).toBe(device);
    expect(request.currentTenant).toEqual({ id: 'tenant-1', role: 'DEVICE' });
  });
});
