import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PlatformSettingsService } from '../platform-identity/approvals/platform-settings.service';

export const VAT_KEY = 'billing.vat';

export interface VatSetting {
  rate_bp: number | null;
  label: string;
  registration: string | null;
}

const DEFAULT: VatSetting = { rate_bp: null, label: 'VAT', registration: null };

/** The `billing.vat` platform setting. A missing row or key reads as "VAT off, no registration". */
@Injectable()
export class VatService {
  constructor(private readonly settings: PlatformSettingsService) {}

  async get(manager?: EntityManager): Promise<VatSetting> {
    const v = await this.settings.get<Partial<VatSetting> | undefined>(VAT_KEY, manager);
    return {
      rate_bp: typeof v?.rate_bp === 'number' ? v.rate_bp : null,
      label: v?.label || DEFAULT.label,
      registration: v?.registration || null,
    };
  }

  async set(value: VatSetting, actorId: string): Promise<void> {
    await this.settings.set(VAT_KEY, value, actorId);
  }
}
