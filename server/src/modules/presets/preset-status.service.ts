import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PresetStatus } from '@biddaloy/shared';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { countRows, FRESH_TENANT_ENTITIES } from './preset-blockers';

@Injectable()
export class PresetStatusService {
  constructor(
    private readonly settings: SchoolSettingsReader,
    private readonly dataSource: DataSource,
  ) {}

  async status(tenantId: string): Promise<PresetStatus> {
    const preset = await this.settings.preset(tenantId);
    if (preset) return { state: 'APPLIED', preset };
    const counts = await countRows(this.dataSource.manager, tenantId, FRESH_TENANT_ENTITIES);
    const blockers = counts.filter((c) => c.count > 0);
    return blockers.length ? { state: 'CUSTOM', blockers } : { state: 'AVAILABLE' };
  }
}
