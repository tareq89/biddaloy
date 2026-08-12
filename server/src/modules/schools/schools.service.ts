import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TenantSettings } from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings } from './settings/tenant-settings-merge.util';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
  ) {}

  async findById(id: string): Promise<School> {
    const school = await this.repo.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(`School with ID "${id}" not found`);
    }
    return school;
  }

  async getResolvedSettings(schoolId: string): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    return resolveTenantSettings(school.settings);
  }

  /**
   * Merges a validated patch into the school's stored settings and
   * persists it. `dto` is expected to have already passed class-validator
   * (either through Nest's global `ValidationPipe`, once #8.7.9 wires a
   * controller, or a direct `validate()` call) — this method does not
   * re-validate, it merges and saves.
   */
  async updateSettings(schoolId: string, dto: TenantSettingsDto): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    school.settings = mergeTenantSettings(school.settings, dto);
    await this.repo.save(school);
    return resolveTenantSettings(school.settings);
  }
}
