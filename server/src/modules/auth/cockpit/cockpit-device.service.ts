import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { PlatformAdminDevice } from '../../platform-identity/entities/platform-admin-device.entity';
import { hashSecret } from '../token-hash.util';

/** [Epic 98] Remembered devices: the cookie holds a random secret, the table only its hash. */
@Injectable()
export class CockpitDeviceService {
  constructor(
    @InjectRepository(PlatformAdminDevice)
    private readonly devices: Repository<PlatformAdminDevice>,
  ) {}

  /** True when the cookie value matches a remembered device of this user; renews `last_seen_at`. */
  async isKnown(userId: string, cookieValue: string | undefined): Promise<boolean> {
    if (!cookieValue) return false;
    const res = await this.devices.update(
      { user_id: userId, device_hash: hashSecret(cookieValue) },
      { last_seen_at: new Date() },
    );
    return (res.affected ?? 0) > 0;
  }

  /** Stores a new device and returns the secret for the cookie (shown to the browser once). */
  async remember(userId: string, userAgent: string | null): Promise<string> {
    const secret = randomBytes(32).toString('hex');
    await this.devices.insert({
      user_id: userId,
      device_hash: hashSecret(secret),
      label: userAgent ? userAgent.slice(0, 120) : null,
    });
    return secret;
  }
}
