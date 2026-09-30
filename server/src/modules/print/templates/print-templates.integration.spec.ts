import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { DocumentKind, type TemplateDefinition } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { PRINT_SUGGESTIONS } from '../suggestions/suggestions';
import { PrintTemplatesService } from './print-templates.service';

/**
 * [32.2.1] create-from-suggestion -> edit draft -> publish -> versions, against a
 * real database. Storage is faked; everything else is real, including the
 * versions-immutable trigger and the one-default-per-kind index.
 */
describe('PrintTemplatesService (integration)', () => {
  let service: PrintTemplatesService;
  let ds: DataSource;
  let tenantB: string;
  const put = vi.fn(async () => undefined);
  const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === 'student-portrait-classic')!;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PrintTemplatesService,
      AuditService,
      { provide: StorageService, useValue: { put } },
    ]);
    service = module.get(PrintTemplatesService);
    ds = module.get(DataSource);
    const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Print B ${randomUUID()}`,
      `print-b-${randomUUID()}`,
    ]);
    tenantB = rows[0].id;
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.destroy();
  });

  it('creates from a suggestion, edits the draft, publishes twice and keeps v1 unchanged', async () => {
    const created = await service.create(SEED_TENANT_ID, SEED_ADMIN_USER_ID, {
      name: 'Student card',
      suggestion_key: suggestion.key,
    });
    // Two artwork sides were stored and recorded as assets; the first template of a kind is the default.
    expect(put).toHaveBeenCalledTimes(2);
    const assets = await ds.query(
      `SELECT asset_kind, content_type FROM print_assets WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    expect(assets).toEqual([
      { asset_kind: 'ARTWORK', content_type: 'image/svg+xml' },
      { asset_kind: 'ARTWORK', content_type: 'image/svg+xml' },
    ]);
    expect(created.is_default).toBe(true);
    expect(created.current_version_id).toBeNull();

    const v1 = await service.publish(SEED_TENANT_ID, SEED_ADMIN_USER_ID, created.id);
    const detail = await service.findOne(SEED_TENANT_ID, created.id);
    expect(detail.current_version?.version).toBe(1);

    const draft: TemplateDefinition = structuredClone(detail.draft);
    draft.copyLabel = { text: 'Duplicate {n}' };
    await service.update(SEED_TENANT_ID, SEED_ADMIN_USER_ID, created.id, { draft });
    const v2 = await service.publish(SEED_TENANT_ID, SEED_ADMIN_USER_ID, created.id);

    expect([v1.version, v2.version]).toEqual([1, 2]);
    const versions = await service.listVersions(SEED_TENANT_ID, created.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // A published version never changes after later edits and publishes.
    const old = await service.findVersion(SEED_TENANT_ID, v1.id);
    expect(old.definition.copyLabel).toEqual({ text: 'Copy {n}' });
    const list = await service.list(SEED_TENANT_ID, {
      document_kind: DocumentKind.STUDENT_ID_CARD,
    });
    expect(list[0]?.current_version).toMatchObject({ id: v2.id, version: 2 });
    // A list row has the same shape as a detail row: the library reads these (a missing
    // `updated_at` crashed it, and a missing `current_version_id` made every draft look published).
    expect(list[0]).toMatchObject({ current_version_id: v2.id, layout_kind: expect.any(String) });
    expect(new Date(list[0]!.updated_at).getTime()).not.toBeNaN();
    expect(new Date(list[0]!.created_at).getTime()).not.toBeNaN();
  });

  it("tenant B cannot read, publish or list tenant A's template", async () => {
    const created = await service.create(SEED_TENANT_ID, SEED_ADMIN_USER_ID, {
      name: 'Private',
      suggestion_key: suggestion.key,
    });
    await expect(service.findOne(tenantB, created.id)).rejects.toThrow(NotFoundException);
    await expect(service.publish(tenantB, SEED_ADMIN_USER_ID, created.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.listVersions(tenantB, created.id)).rejects.toThrow(NotFoundException);
    expect(await service.list(tenantB, {})).toEqual([]);
  });
});
