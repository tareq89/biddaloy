import { describe, expect, it, vi } from 'vitest';
import type { ImportContext } from '../../codec/tab-spec';
import { collectAssetRefs, mapAssetRefs } from './asset-refs';
import { printAssetsTab, assetKeyTail } from './print-assets.tab';
import { printerProfilesTab } from './printer-profiles.tab';
import { printTemplatesTab } from './print-templates.tab';
import { printTemplateVersionsTab } from './print-template-versions.tab';

const SCHOOL = 'school-b';
/** Exports always write an id; restore ignores it for new rows and mints a fresh one. */
const ID = '00000000-0000-4000-8000-000000000001';
const ASSET_KEY = 'print-assets/11111111-1111-4111-8111-111111111111.png';

/** An import context whose only known asset is `ASSET_KEY`, and only known template is 'STUDENT_ID_CARD|Classic'. */
function ctx(warn = vi.fn()): ImportContext {
  return {
    tenantId: SCHOOL,
    ref: (tab, key) =>
      (tab === 'print_assets' && key === ASSET_KEY && 'asset-id-b') ||
      (tab === 'print_templates' && key === 'STUDENT_ID_CARD|Classic' && 'template-id-b') ||
      undefined,
    warn,
  };
}

describe('asset-refs', () => {
  const definition = {
    front: {
      background: { assetId: 'A', print: true },
      elements: [
        { id: 't', type: 'TEXT', fontAssetId: 'F', field: 'student.name' },
        { id: 'i', type: 'IMAGE', assetId: 'A' },
        { id: 'p', type: 'IMAGE', field: 'student.photo' }, // no assetId: left alone
      ],
    },
    note: 'assetId stays plain text here',
  };

  it('replaces assetId and fontAssetId everywhere, and touches nothing else', () => {
    const mapped = mapAssetRefs(definition, (id) => `key:${id}`) as typeof definition;
    expect(mapped.front.background.assetId).toBe('key:A');
    expect(mapped.front.elements[0]?.fontAssetId).toBe('key:F');
    expect(mapped.front.elements[1]?.assetId).toBe('key:A');
    expect(mapped.front.elements[2]).toEqual({ id: 'p', type: 'IMAGE', field: 'student.photo' });
    expect(mapped.note).toBe('assetId stays plain text here');
  });

  it('does not mutate its input, and survives a JSON round trip', () => {
    const before = JSON.stringify(definition);
    const mapped = mapAssetRefs(definition, (id) => `key:${id}`);
    expect(JSON.stringify(definition)).toBe(before);
    expect(JSON.parse(JSON.stringify(mapped))).toEqual(mapped);
  });

  it('lists every reference (with repeats)', () => {
    expect(collectAssetRefs(definition)).toEqual(['A', 'F', 'A']);
  });
});

describe('print_assets tab', () => {
  const cells = (storageKey: string) => ({
    id: ID,
    asset_kind: 'ARTWORK',
    storage_key: storageKey,
    content_type: 'image/png',
    byte_size: '4096',
    width_px: '1011',
    height_px: '638',
    font_family: '',
    original_name: 'front.png',
    archived_at: '',
  });

  it('keeps the key when it already belongs to this school', () => {
    const warn = vi.fn();
    const out = printAssetsTab.fromRow(cells(`tenants/${SCHOOL}/${ASSET_KEY}`), 2, ctx(warn));
    expect('row' in out && out.row.storage_key).toBe(`tenants/${SCHOOL}/${ASSET_KEY}`);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rewrites another school's prefix to this school and warns (never reads a foreign file)", () => {
    const warn = vi.fn();
    const out = printAssetsTab.fromRow(cells(`tenants/school-a/${ASSET_KEY}`), 2, ctx(warn));
    expect('row' in out && out.row.storage_key).toBe(`tenants/${SCHOOL}/${ASSET_KEY}`);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ severity: 'warning', column: 'storage_key' });
  });

  it.each(['no-prefix/at-all.png', `tenants/${SCHOOL}/../school-a/x.png`, 'tenants//x.png'])(
    'rejects a storage key that is not a tenant-scoped key: %s',
    (key) => {
      const out = printAssetsTab.fromRow(cells(key), 2, ctx());
      expect('errors' in out && out.errors[0]?.column).toBe('storage_key');
    },
  );

  it('identifies an asset by its tenant-independent tail, so ids survive a move between schools', () => {
    expect(assetKeyTail(`tenants/school-a/${ASSET_KEY}`)).toBe(ASSET_KEY);
    expect(assetKeyTail(`tenants/school-b/${ASSET_KEY}`)).toBe(ASSET_KEY);
  });
});

describe('printer_profiles tab', () => {
  const cells = (over: Record<string, string> = {}) => ({
    id: ID,
    name: 'Front office',
    printer_type: 'CARD',
    margin_top_mm: '0',
    margin_right_mm: '0',
    margin_bottom_mm: '0',
    margin_left_mm: '0',
    offset_x_mm: '1.5',
    offset_y_mm: '-0.5',
    scale: '1.005',
    duplex_order: 'INTERLEAVED',
    sheet_gap_mm: '2',
    archived_at: '',
    ...over,
  });

  it('accepts an in-range printer', () => {
    const out = printerProfilesTab.fromRow(cells(), 2, ctx());
    expect('row' in out && out.row).toMatchObject({ name: 'Front office', offset_x_mm: '1.5' });
  });

  it.each([
    ['offset_x_mm', '11'],
    ['offset_y_mm', '-10.1'],
    ['scale', '1.2'],
    ['margin_top_mm', '-1'],
    ['sheet_gap_mm', '21'],
    ['scale', 'abc'],
  ])('rejects %s = %s (same bounds as the API)', (column, value) => {
    const out = printerProfilesTab.fromRow(cells({ [column]: value }), 2, ctx());
    expect('errors' in out && out.errors.map((e) => e.column)).toContain(column);
  });

  it('compares numeric text as numbers ("5" equals "5.00")', () => {
    const row = printerProfilesTab.fromRow(cells({ margin_top_mm: '5' }), 2, ctx());
    if (!('row' in row)) throw new Error('row expected');
    expect(
      printerProfilesTab.diffFields(row.row, { ...row.row, margin_top_mm: '5.00' } as never),
    ).toEqual([]);
  });
});

describe('print_templates tab', () => {
  const cells = (draft: unknown) => ({
    id: ID,
    document_kind: 'STUDENT_ID_CARD',
    layout_kind: 'FIXED',
    name: 'Classic',
    is_default: 'true',
    batch_size: '50',
    draft: JSON.stringify(draft),
    archived_at: '',
  });

  it('exports asset ids as keys and imports them back as ids of the restored assets', () => {
    const entity = {
      id: 't',
      document_kind: 'STUDENT_ID_CARD',
      layout_kind: 'FIXED',
      name: 'Classic',
      is_default: true,
      batch_size: 50,
      draft: { front: { background: { assetId: 'asset-id-a', print: true } } },
      archived_at: null,
    };
    const exported = printTemplatesTab.toRow(entity as never, { keyOf: () => ASSET_KEY });
    expect(exported.draft).toEqual({ front: { background: { assetId: ASSET_KEY, print: true } } });

    const out = printTemplatesTab.fromRow(cells(exported.draft), 2, ctx());
    expect('row' in out && out.row.draft).toEqual({
      front: { background: { assetId: 'asset-id-b', print: true } },
    });
  });

  it('a draft pointing at an asset that was not restored is a row error (no dangling reference)', () => {
    const out = printTemplatesTab.fromRow(
      cells({ front: { background: { assetId: 'print-assets/unknown.png' } } }),
      2,
      ctx(),
    );
    expect('errors' in out && out.errors[0]).toMatchObject({ column: 'draft', severity: 'error' });
  });

  it('does not export current_version_id (the versions tab restores that link)', () => {
    expect(printTemplatesTab.columns.map((c) => c.key)).not.toContain('current_version_id');
    expect(printTemplatesTab.excluded).toContain('current_version_id');
  });
});

describe('print_template_versions tab', () => {
  const cells = (over: Record<string, string> = {}) => ({
    id: ID,
    template: 'STUDENT_ID_CARD|Classic',
    version: '2',
    definition: JSON.stringify({ front: { background: { assetId: ASSET_KEY, print: true } } }),
    published_at: '2027-03-01T00:00:00.000Z',
    is_current: 'true',
    ...over,
  });

  it('resolves the template and the assets, and remaps the definition', () => {
    const out = printTemplateVersionsTab.fromRow(cells(), 2, ctx());
    if (!('row' in out)) throw new Error('row expected');
    expect(out.row).toMatchObject({ template_id: 'template-id-b', version: 2, is_current: true });
    expect(out.row.definition).toEqual({
      front: { background: { assetId: 'asset-id-b', print: true } },
    });
  });

  it('errors on a template or asset that was not restored', () => {
    const noTemplate = printTemplateVersionsTab.fromRow(
      cells({ template: 'STUDENT_ID_CARD|Nope' }),
      2,
      ctx(),
    );
    expect('errors' in noTemplate && noTemplate.errors[0]?.column).toBe('template');
    const noAsset = printTemplateVersionsTab.fromRow(
      cells({
        definition: JSON.stringify({ front: { background: { assetId: 'print-assets/x.png' } } }),
      }),
      2,
      ctx(),
    );
    expect('errors' in noAsset && noAsset.errors[0]?.column).toBe('definition');
  });

  it('a row and an entity for the same version share one key', () => {
    const out = printTemplateVersionsTab.fromRow(cells(), 2, ctx());
    if (!('row' in out)) throw new Error('row expected');
    const entity = Object.assign(new (printTemplateVersionsTab.entity as new () => object)(), {
      version: 2,
      template: { document_kind: 'STUDENT_ID_CARD', name: 'Classic' },
    });
    expect(printTemplateVersionsTab.keyOf(entity as never)).toBe(
      printTemplateVersionsTab.keyOf(out.row),
    );
  });

  it('never deletes a published version', async () => {
    expect(printTemplateVersionsTab.deleteByAbsence).toBe(false);
    await expect(printTemplateVersionsTab.remove({} as never, {} as never)).rejects.toThrow(
      /immutable/,
    );
  });
});
