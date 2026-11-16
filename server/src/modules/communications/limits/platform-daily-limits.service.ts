import { Injectable } from '@nestjs/common';
import {
  CommunicationMedium,
  DAILY_LIMITS_PLATFORM_KEY,
  type DailyLimitChannel,
  type DailyLimitsView,
  type DailySendLimits,
} from '@biddaloy/shared';
import { PlatformSettingsService } from '../../platform-identity/approvals/platform-settings.service';
import { SchoolsService } from '../../schools/schools.service';
import { sanitiseDailyLimits } from '../../schools/settings/tenant-settings-resolver';
import { SendLimitService } from './send-limit.service';
import { UpdateDailyLimitsDto } from './dto/daily-limits.dto';

const CHANNELS: DailyLimitChannel[] = ['sms', 'email', 'whatsapp'];
const MEDIUM: Record<DailyLimitChannel, CommunicationMedium> = {
  sms: CommunicationMedium.SMS,
  email: CommunicationMedium.EMAIL,
  whatsapp: CommunicationMedium.WHATSAPP,
};
type Ctx = { ip: string | null; userAgent: string | null };

/** [60.2.08 D17, D31] Cockpit read/write of the platform default and one school's daily send limits. */
@Injectable()
export class PlatformDailyLimitsService {
  constructor(
    private readonly platform: PlatformSettingsService,
    private readonly schools: SchoolsService,
    private readonly limits: SendLimitService,
  ) {}

  /** `null` in the patch removes a value, `undefined` keeps it. */
  private static patch(stored: DailySendLimits, dto: UpdateDailyLimitsDto): DailySendLimits {
    const out: Record<string, unknown> = { ...stored };
    for (const [k, v] of Object.entries(dto)) {
      if (v === null) delete out[k];
      else if (v !== undefined) out[k] = v;
    }
    return out as DailySendLimits;
  }

  private async platformStored(): Promise<DailySendLimits> {
    return (sanitiseDailyLimits(await this.platform.get(DAILY_LIMITS_PLATFORM_KEY)) ??
      {}) as DailySendLimits;
  }

  async getPlatform(): Promise<DailyLimitsView> {
    return {
      stored: await this.platformStored(),
      effective: await this.limits.platformEffective(),
      usedToday: null,
    };
  }

  async putPlatform(dto: UpdateDailyLimitsDto, actorId: string): Promise<DailyLimitsView> {
    await this.platform.update<unknown>(
      DAILY_LIMITS_PLATFORM_KEY,
      (old) =>
        PlatformDailyLimitsService.patch((sanitiseDailyLimits(old) ?? {}) as DailySendLimits, dto),
      actorId,
    );
    this.limits.invalidateDefaults();
    return this.getPlatform();
  }

  async getSchool(schoolId: string): Promise<DailyLimitsView> {
    const settings = await this.schools.getDecryptedSettings(schoolId); // 404 for an unknown school
    const stored = (sanitiseDailyLimits(settings.communications?.dailyLimits) ??
      {}) as DailySendLimits;
    const effective = await this.limits.effective(schoolId);
    const used = {} as Record<DailyLimitChannel, number>;
    for (const c of CHANNELS) {
      const r = await this.limits.remaining(schoolId, MEDIUM[c]);
      used[c] = r.limit - r.remaining;
    }
    return { stored, effective, usedToday: used };
  }

  async putSchool(
    schoolId: string,
    dto: UpdateDailyLimitsDto,
    actorId: string,
    context: Ctx,
  ): Promise<DailyLimitsView> {
    // nulls go straight into the settings merge, which deletes the key. 404 comes before any write.
    await this.schools.updateSettings(
      schoolId,
      { communications: { dailyLimits: { ...dto } } } as never,
      actorId,
      context,
      true,
    );
    return this.getSchool(schoolId);
  }
}
