import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../modules/audit/audit.service';
import { Class } from '../modules/academics/entities/class.entity';
import { School } from '../modules/schools/entities/school.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { TenantSettingsCache } from '../modules/schools/settings/tenant-settings-cache.service';
import { PresetApplyService } from '../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../modules/presets/preset-registry.service';
import { makeTestPack } from '../modules/presets/__fixtures__/test-pack';
import { ensurePresetDemoSeed, FRESH_DEMO_SCHOOL } from './seed.util';

// DB-backed, so it lives here (`*.integration.spec.ts`) and not in the
// mock-only unit spec `seed.util.spec.ts`.
describe('ensurePresetDemoSeed (integration)', () => {
  let ds: DataSource;
  let apply: PresetApplyService;
  let registry: PresetRegistryService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    apply = module.get(PresetApplyService);
    registry = module.get(PresetRegistryService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('is idempotent, creates an empty tenant with one ADMIN, and a pack applies to it', async () => {
    const first = await ensurePresetDemoSeed(ds.manager, 'x');
    const second = await ensurePresetDemoSeed(ds.manager, 'x');

    expect(second.id).toBe(first.id);
    expect(await ds.getRepository(School).countBy({ slug: FRESH_DEMO_SCHOOL.slug })).toBe(1);
    expect(await ds.getRepository(UserTenant).countBy({ tenant_id: first.id })).toBe(1);
    expect(await ds.getRepository(Class).countBy({ tenant_id: first.id })).toBe(0);
    expect(first.settings?.preset).toBeUndefined();

    registry.packs = [makeTestPack()];
    const admin = await ds.getRepository(UserTenant).findOneByOrFail({ tenant_id: first.id });
    const { created } = await apply.apply(first.id, admin.user_id, {
      preset_id: 'test/pack',
      start_year: 2026,
      stages: ['PRIMARY', 'SECONDARY'],
    });
    expect(created).toMatchObject({ classes: 3, subjects: 4, examTemplates: 1 });
    expect(await ds.getRepository(Class).countBy({ tenant_id: first.id })).toBe(3);
  });
});
