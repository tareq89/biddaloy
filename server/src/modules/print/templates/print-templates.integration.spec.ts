import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { DocumentKind, type TemplateDefinition } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { AuditService } from '../../audit/audit.service';
import { SchoolsService } from '../../schools/schools.service';
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
  let tenantA: string;
  let tenantB: string;
  const put = vi.fn(async () => undefined);
  // Real SchoolsService needs half the app; label reading itself is covered in schools specs.
  const labelsByTenant: Record<string, object> = {};
  const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === 'student-portrait-classic')!;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PrintTemplatesService,
      AuditService,
      { provide: StorageService, useValue: { put } },
      {
        provide: SchoolsService,
        useValue: { getSchoolLabels: async (id: string) => labelsByTenant[id] ?? {} },
      },
    ]);
    service = module.get(PrintTemplatesService);
    ds = module.get(DataSource);
    const school = async (tag: string) =>
      (
        await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
          `Print ${tag} ${randomUUID()}`,
          `print-${tag}-${randomUUID()}`,
        ])
      )[0].id as string;
    tenantA = await school('a');
    tenantB = await school('b');
  });

  afterAll(async () => {
    // tenantA keeps its rows (audit_logs block deleting the school), like the sibling print specs; it is unique per run.
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.destroy();
  });

  it('admit card says Batch for a school that renamed Section; another school keeps stock', async () => {
    labelsByTenant[tenantA] = { section: { en: { one: 'Batch' }, bn: 'ব্যাচ' } };
    const captions = async (tenant: string, key: string, name: string) => {
      const t = await service.create(tenant, SEED_ADMIN_USER_ID, { name, suggestion_key: key });
      return (t.draft as TemplateDefinition).front.elements.flatMap((e) =>
        e.type === 'TEXT' && !e.field ? [e.text as string] : [],
      );
    };
    const a = await captions(tenantA, 'admit-card-en', 'Admit A en');
    const abn = await captions(tenantA, 'admit-card-bn', 'Admit A bn');
    const b = await captions(tenantB, 'admit-card-en', 'Admit B en');
    expect(a).toContain('Batch:');
    expect(abn).toContain('ব্যাচ:');
    // Tenant isolation: B never sees A's word.
    expect(b).toContain('Section:');
    expect(b).not.toContain('Batch:');
    put.mockClear(); // the next test counts its own uploads
  });

  it('creates from a suggestion, edits the draft, publishes twice and keeps v1 unchanged', async () => {
    const countAssets = async () =>
      (
        await ds.query(`SELECT count(*)::int AS n FROM print_assets WHERE tenant_id = $1`, [
          tenantA,
        ])
      )[0].n as number;
    const assetsBefore = await countAssets();
    const created = await service.create(tenantA, SEED_ADMIN_USER_ID, {
      name: 'Student card',
      suggestion_key: suggestion.key,
    });
    // Two artwork sides were stored and recorded as assets; the first template of a kind is the default.
    expect(put).toHaveBeenCalledTimes(2);
    // Earlier tests also store assets for tenantA, so count only the rows this test adds.
    expect((await countAssets()) - assetsBefore).toBe(2);
    expect(created.is_default).toBe(true);
    expect(created.current_version_id).toBeNull();

    const v1 = await service.publish(tenantA, SEED_ADMIN_USER_ID, created.id);
    const detail = await service.findOne(tenantA, created.id);
    expect(detail.current_version?.version).toBe(1);

    const draft: TemplateDefinition = structuredClone(detail.draft);
    draft.copyLabel = { text: 'Duplicate {n}' };
    await service.update(tenantA, SEED_ADMIN_USER_ID, created.id, { draft });
    const v2 = await service.publish(tenantA, SEED_ADMIN_USER_ID, created.id);

    expect([v1.version, v2.version]).toEqual([1, 2]);
    const versions = await service.listVersions(tenantA, created.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // A published version never changes after later edits and publishes.
    const old = await service.findVersion(tenantA, v1.id);
    expect(old.definition.copyLabel).toEqual({ text: 'Copy {n}' });
    const list = await service.list(tenantA, {
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
    const created = await service.create(tenantA, SEED_ADMIN_USER_ID, {
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

  it('creates and publishes the front-only A4 ACR suggestion (one artwork, no back)', async () => {
    put.mockClear();
    const created = await service.create(tenantA, SEED_ADMIN_USER_ID, {
      name: 'ACR A4',
      suggestion_key: 'acr-a4-standard',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(created.draft.back).toBeUndefined();
    expect(created.draft.page.sides).toEqual(['front']);
    expect(created.document_kind).toBe(DocumentKind.ACR_ASSESSMENT);
    const v = await service.publish(tenantA, SEED_ADMIN_USER_ID, created.id);
    expect(v.version).toBe(1);
  });
});
