import { randomBytes, createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttendanceDeviceStatus, AuditAction } from '@biddaloy/shared';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AuditService } from '../../audit/audit.service';
import { CreateDeviceDto, DeviceResponseDto, DeviceWithKeyResponseDto } from '../dto/device.dto';

const KEY_PREFIX = 'bd_dev_';

/**
 * The one place that mints, hashes and verifies a device's credential.
 * `DeviceAuthGuard` depends on `hashDeviceKey` producing the same digest
 * this service stores at creation/rotation time.
 */
export function hashDeviceKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates a new device credential. SHA-256, not bcrypt/argon2: the key
 * is 256 bits of CSPRNG output, not a human-chosen password, so there is
 * nothing for a slow hash to protect against — brute force is already
 * infeasible. A fast hash additionally lets `DeviceAuthGuard` find the
 * device with a single indexed lookup on `token_hash`, instead of scanning
 * every device row in the tenant to run a slow comparison per request —
 * that matters when a turnstile posts every few seconds.
 *
 * The prefix makes the key greppable in a customer's config file and
 * recognisable in a leak scan. The hash covers the *prefixed* string, so
 * what the customer pastes is exactly what gets hashed and compared.
 */
function generateDeviceKey(): { raw: string; hash: string; last4: string } {
  const raw = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { raw, hash: hashDeviceKey(raw), last4: raw.slice(-4) };
}

function toResponse(device: AttendanceDevice): DeviceResponseDto {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    token_last4: device.token_last4,
    section_id: device.section_id,
    roster_access: device.roster_access,
    status: device.status,
    last_seen_at: device.last_seen_at ? device.last_seen_at.toISOString() : null,
  };
}

/**
 * Device management — create, list, rotate, revoke. Every route here is
 * behind the ordinary JWT guard stack (`ADMIN`/`EXECUTIVE`), unlike
 * `DeviceEventsService`, which is behind `DeviceAuthGuard` instead.
 */
@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(AttendanceDevice)
    private readonly deviceRepo: Repository<AttendanceDevice>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    private readonly auditService: AuditService,
  ) {}

  async create(params: {
    tenantId: string;
    userId: string;
    dto: CreateDeviceDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<DeviceWithKeyResponseDto> {
    const { tenantId, userId, dto, ip, userAgent } = params;

    // `dto.section_id` is caller-supplied — without this check an admin
    // from tenant A could bind a device to a section belonging to
    // tenant B (IDOR).
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.section_id, tenant_id: tenantId },
      });
      if (!section) {
        throw new BadRequestException('section_id does not belong to this tenant');
      }
    }

    const { raw, hash, last4 } = generateDeviceKey();

    const device = await this.deviceRepo.save(
      this.deviceRepo.create({
        tenant_id: tenantId,
        name: dto.name,
        kind: dto.kind,
        token_hash: hash,
        token_last4: last4,
        section_id: dto.section_id ?? null,
        roster_access: dto.roster_access ?? false,
        status: AttendanceDeviceStatus.ACTIVE,
        created_by_user_id: userId,
      }),
    );

    // Never the key or its hash — an audit row is not the place to keep a
    // second copy of a credential.
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'AttendanceDevice',
      entity_id: device.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
      old_values: null,
      new_values: { name: device.name, kind: device.kind, roster_access: device.roster_access },
    });

    return { device: toResponse(device), key: raw };
  }

  async list(tenantId: string): Promise<DeviceResponseDto[]> {
    const devices = await this.deviceRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
    return devices.map(toResponse);
  }

  async rotate(params: {
    tenantId: string;
    deviceId: string;
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<DeviceWithKeyResponseDto> {
    const { tenantId, deviceId, userId, ip, userAgent } = params;
    const device = await this.findOwned(tenantId, deviceId);

    // No grace period — a rotate is what you do when a key leaked. The old
    // hash is overwritten immediately, so the old key stops working the
    // instant this call succeeds.
    const { raw, hash, last4 } = generateDeviceKey();
    device.token_hash = hash;
    device.token_last4 = last4;
    await this.deviceRepo.save(device);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'AttendanceDevice',
      entity_id: device.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
      old_values: { token_last4: '[REDACTED]' },
      new_values: { token_last4: device.token_last4 },
    });

    return { device: toResponse(device), key: raw };
  }

  async revoke(params: {
    tenantId: string;
    deviceId: string;
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    const { tenantId, deviceId, userId, ip, userAgent } = params;
    const device = await this.findOwned(tenantId, deviceId);

    // Never a hard delete — the device's past events must keep resolving
    // to a named device.
    device.status = AttendanceDeviceStatus.REVOKED;
    device.revoked_at = new Date();
    await this.deviceRepo.save(device);

    await this.auditService.record({
      action: AuditAction.DELETE,
      entity_type: 'AttendanceDevice',
      entity_id: device.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
      old_values: { status: AttendanceDeviceStatus.ACTIVE },
      new_values: { status: device.status, revoked_at: device.revoked_at },
    });
  }

  private async findOwned(tenantId: string, deviceId: string): Promise<AttendanceDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenant_id: tenantId },
    });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return device;
  }
}
