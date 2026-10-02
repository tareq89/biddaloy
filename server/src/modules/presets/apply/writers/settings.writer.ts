import { NotFoundException } from '@nestjs/common';
import { School } from '../../../schools/entities/school.entity';
import { DEFAULT_REGION_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { mergeApplySettings } from '../../../schools/settings/tenant-settings-merge.util';
import type { ApplyWriter } from '../apply-context';

/** Runs first: sets vocabulary (versions/groups), region and the preset block. Caller invalidates cache after commit. */
export const writeSettings: ApplyWriter = async (ctx) => {
  const { pack, options } = ctx;
  const repo = ctx.manager.getRepository(School);
  const school = await repo.findOne({ where: { id: ctx.tenantId } });
  if (!school) throw new NotFoundException('School not found');

  const stored = school.settings ?? {};
  school.settings = mergeApplySettings(stored, {
    organisation: {
      shifts: [],
      versions: pack.versions?.length ? options.versions : [],
      groups: pack.groups,
    },
    region: { ...DEFAULT_REGION_SETTINGS, ...(stored.region ?? {}), ...(pack.region ?? {}) },
    preset: {
      id: pack.id,
      version: pack.version,
      appliedAt: new Date().toISOString(),
      appliedByUserId: ctx.userId,
    },
  });
  await repo.save(school);
  return { settings: 1 };
};
