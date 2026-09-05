import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttendanceDeviceStatus } from '@biddaloy/shared';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { hashDeviceKey } from './device.service';

/**
 * Authenticates a device by its `X-Device-Key` header instead of a JWT.
 * Deliberately **not** combined with `ContextGuard`/`RolesGuard`: a device
 * has no `X-Tenant-ID` header and no JWT membership list — its tenant is a
 * property of the key itself. Trusting a device-supplied `X-Tenant-ID`
 * would let a valid key from school A write into school B.
 *
 * `role: 'DEVICE'` is deliberately not a `UserRole` and is not in
 * `ROLE_PRIORITY` (`context.guard.ts`) — device routes must never be
 * combined with `RolesGuard`, and a device must never satisfy a
 * `@Roles(...)` check.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(AttendanceDevice)
    private readonly deviceRepo: Repository<AttendanceDevice>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const raw = request.headers['x-device-key'];

    // The 401 message is identical for "no key", "unknown key" and
    // "revoked key", so this endpoint is not an oracle for which keys
    // exist.
    if (typeof raw !== 'string' || raw.length < 20) {
      throw new UnauthorizedException('Device key required');
    }

    const device = await this.deviceRepo.findOne({
      where: { token_hash: hashDeviceKey(raw), status: AttendanceDeviceStatus.ACTIVE },
    });
    if (!device) {
      throw new UnauthorizedException('Invalid device key');
    }

    // `last_seen_at` is not written here — a write on every request turns
    // a read-only guard into a hot write path on a turnstile posting
    // every few seconds. The ingest service and the heartbeat route
    // update it instead.
    request.currentDevice = device;
    request.currentTenant = { id: device.tenant_id, role: 'DEVICE' };
    return true;
  }
}
