import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../print/entities/print-template-version.entity';
import { printTemplatesTab, type PrintTemplateRow } from './print-templates.tab';
import {
  printTemplateVersionsTab,
  type PrintTemplateVersionRow,
} from './print-template-versions.tab';

/**
 * Against the real database: the parts of the print tabs a mock can't prove —
 * the immutability trigger, the one-default-per-kind index, and the circular
 * template <-> version link. (The full export -> restore-into-another-school
 * path is `test/workbook-roundtrip.integration.spec.ts`.)
 */
describe('print workbook tabs (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
  let template: PrintTemplate;
  let version1: PrintTemplateVersion;

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`PT ${randomUUID()}`, `pt-${randomUUID()}`],
    );
    tenantId = school.id;
    template = await ds.getRepository(PrintTemplate).save(
      ds.getRepository(PrintTemplate).create({
        tenant_id: tenantId,
        document_kind: 'STUDENT_ID_CARD',
        layout_kind: 'FIXED',
        name: 'Classic',
        is_default: true,
        batch_size: 50,
        draft: { label: 'draft' } as never,
      }),
    );
    version1 = await ds.getRepository(PrintTemplateVersion).save(
      ds.getRepository(PrintTemplateVersion).create({
        tenant_id: tenantId,
        template_id: template.id,
        version: 1,
        definition: { label: 'v1' } as never,
      }),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const versionRow = (over: Partial<PrintTemplateVersionRow> = {}): PrintTemplateVersionRow => ({
    id: randomUUID(),
    template_id: template.id,
    template_key: 'STUDENT_ID_CARD|Classic',
    version: 1,
    definition: { label: 'v1' } as never,
    published_at: new Date(),
    is_current: false,
    ...over,
  });

  it('restoring a version whose content differs fails loudly and leaves the published one untouched', async () => {
    await expect(
      ds.transaction((m) =>
        printTemplateVersionsTab.upsert(
          versionRow({ definition: { label: 'CHANGED' } as never }),
          version1,
          tenantId,
          m,
        ),
      ),
    ).rejects.toThrow(/immutable/);

    const stored = await ds
      .getRepository(PrintTemplateVersion)
      .findOneByOrFail({ id: version1.id });
    expect(stored.definition).toEqual({ label: 'v1' });
  });

  it('restoring identical content is a no-op on the version row (an UPDATE would hit the trigger)', async () => {
    await expect(
      ds.transaction((m) => printTemplateVersionsTab.upsert(versionRow(), version1, tenantId, m)),
    ).resolves.toMatchObject({ id: version1.id });
  });

  it('inserts a new version and points the template at it, in one transaction', async () => {
    await ds.transaction((m) =>
      printTemplateVersionsTab.upsert(
        versionRow({ version: 2, definition: { label: 'v2' } as never, is_current: true }),
        null,
        tenantId,
        m,
      ),
    );

    const versions = await ds
      .getRepository(PrintTemplateVersion)
      .find({ where: { template_id: template.id }, order: { version: 'ASC' } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const reloaded = await ds.getRepository(PrintTemplate).findOneByOrFail({ id: template.id });
    expect(reloaded.current_version_id).toBe(versions[1]?.id);
  });

  it('does not move the current pointer for a version that is not marked current', async () => {
    await ds
      .getRepository(PrintTemplate)
      .update({ id: template.id }, { current_version_id: version1.id });
    await ds.transaction((m) =>
      printTemplateVersionsTab.upsert(
        versionRow({ version: 2, definition: { label: 'v2' } as never, is_current: false }),
        null,
        tenantId,
        m,
      ),
    );
    const reloaded = await ds.getRepository(PrintTemplate).findOneByOrFail({ id: template.id });
    expect(reloaded.current_version_id).toBe(version1.id);
  });

  it('a restored default template replaces the existing default instead of hitting the unique index', async () => {
    const incoming: PrintTemplateRow = {
      id: randomUUID(),
      document_kind: 'STUDENT_ID_CARD',
      layout_kind: 'FIXED',
      name: 'Modern',
      is_default: true,
      batch_size: 25,
      draft: { label: 'modern' } as never,
      archived_at: null,
    };
    await ds.transaction((m) => printTemplatesTab.upsert(incoming, null, tenantId, m));

    const defaults = await ds
      .getRepository(PrintTemplate)
      .find({ where: { tenant_id: tenantId, document_kind: 'STUDENT_ID_CARD', is_default: true } });
    expect(defaults.map((t) => t.name)).toEqual(['Modern']);
  });

  it('a new template starts with no current version until its versions are restored', async () => {
    const saved = await ds.transaction((m) =>
      printTemplatesTab.upsert(
        {
          id: randomUUID(),
          document_kind: 'STAFF_ID_CARD',
          layout_kind: 'FIXED',
          name: 'Staff',
          is_default: false,
          batch_size: 50,
          draft: {} as never,
          archived_at: null,
        },
        null,
        tenantId,
        m,
      ),
    );
    expect(saved.current_version_id).toBeNull();
  });
});
