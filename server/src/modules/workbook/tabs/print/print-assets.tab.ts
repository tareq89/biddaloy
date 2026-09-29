import type { EntityManager } from 'typeorm';
import { PrintAssetKind } from '@biddaloy/shared';
import { PrintAsset } from '../../../print/entities/print-asset.entity';
import { fromCell, toCell } from '../../codec/cell-format';
import { rehomeStorageKey, storageKeyTail } from '../../codec/storage-key-scope';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `print_assets` tab (32.3.10, D44): uploaded print artwork, images and
 * fonts. **Metadata only** — like `staff_documents`, a backup carries the
 * `storage_key`, never the bytes, so the object must already exist at the
 * destination (or be re-uploaded).
 *
 * Tenant safety: `storage_key` starts with `tenants/<school id>/`. A restore
 * into a DIFFERENT school must never keep the source school's prefix, or the
 * new row would let the asset stream endpoint read another school's file. So
 * the prefix is rewritten to the destination school (a dangling key = a 404,
 * never a leak) and a warning says the file must be re-uploaded.
 *
 * Natural key = the key's tenant-independent tail (`print-assets/<uuid>.png`),
 * which is also what templates use to point at an asset (see `asset-refs.ts`).
 */
export interface PrintAssetRow {
  id: string;
  asset_kind: PrintAssetKind;
  storage_key: string;
  asset_key: string;
  content_type: string;
  byte_size: number;
  width_px: number | null;
  height_px: number | null;
  font_family: string | null;
  original_name: string;
  archived_at: Date | null;
}

/** The asset's tenant-independent key, which templates use to point at it. */
export const assetKeyTail = storageKeyTail;

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'asset_kind',
    type: 'enum',
    required: true,
    enumValues: Object.values(PrintAssetKind),
    label: { en: 'Kind', bn: 'ধরন' },
  },
  {
    key: 'storage_key',
    type: 'string',
    required: true,
    label: { en: 'Storage key', bn: 'সংরক্ষণ কী' },
  },
  {
    key: 'content_type',
    type: 'string',
    required: true,
    label: { en: 'Content type', bn: 'বিষয়বস্তুর ধরন' },
  },
  {
    key: 'byte_size',
    type: 'int',
    required: true,
    label: { en: 'Size (bytes)', bn: 'আকার (বাইট)' },
  },
  { key: 'width_px', type: 'int', label: { en: 'Width (px)', bn: 'প্রস্থ (পিক্সেল)' } },
  { key: 'height_px', type: 'int', label: { en: 'Height (px)', bn: 'উচ্চতা (পিক্সেল)' } },
  { key: 'font_family', type: 'string', label: { en: 'Font family', bn: 'ফন্টের নাম' } },
  {
    key: 'original_name',
    type: 'string',
    required: true,
    label: { en: 'Original name', bn: 'মূল নাম' },
  },
  { key: 'archived_at', type: 'datetime', label: { en: 'Archived at', bn: 'আর্কাইভের সময়' } },
];

const excluded: readonly string[] = [
  'uploaded_by', // audit "who uploaded" field, not needed for restore fidelity
];

export const printAssetsTab: TabSpec<PrintAsset, PrintAssetRow> = {
  name: 'print_assets',
  entity: PrintAsset,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['storage_key'],
  // Published versions and job snapshots point at these objects; they are never deleted (invariant).
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<PrintAsset[]> {
    return m.find(PrintAsset, { where: { tenant_id: tenantId } });
  },

  toRow(entity: PrintAsset, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      asset_kind: entity.asset_kind,
      storage_key: entity.storage_key,
      content_type: entity.content_type,
      byte_size: entity.byte_size,
      width_px: entity.width_px,
      height_px: entity.height_px,
      font_family: entity.font_family,
      original_name: entity.original_name,
      archived_at: entity.archived_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PrintAssetRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'print_assets', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }

    const rawKey = (v.storage_key as string | undefined) ?? '';
    const rehomed = rehomeStorageKey(rawKey, ctx.tenantId);
    if (!rehomed) {
      errors.push({
        tab: 'print_assets',
        row: rowNo,
        column: 'storage_key',
        message: `Column "storage_key": "${rawKey}" is not a valid asset storage key.`,
        severity: 'error',
        value: rawKey,
      });
    }
    if (errors.length > 0 || !rehomed) return { errors };

    if (rehomed.moved) {
      ctx.warn({
        tab: 'print_assets',
        row: rowNo,
        column: 'storage_key',
        message: `This asset came from another school. Its file was not copied; re-upload it (${rehomed.tail}).`,
        severity: 'warning',
        value: rawKey,
      });
    }

    return {
      row: {
        id: v.id as string,
        asset_kind: v.asset_kind as PrintAssetKind,
        storage_key: rehomed.key,
        asset_key: rehomed.tail,
        content_type: v.content_type as string,
        byte_size: v.byte_size as number,
        width_px: (v.width_px as number | undefined) ?? null,
        height_px: (v.height_px as number | undefined) ?? null,
        font_family: (v.font_family as string | undefined) ?? null,
        original_name: v.original_name as string,
        archived_at: (v.archived_at as Date | undefined) ?? null,
      },
    };
  },

  keyOf(x: PrintAssetRow | PrintAsset): string {
    return assetKeyTail(x.storage_key);
  },

  diffFields(row: PrintAssetRow, existing: PrintAsset): string[] {
    const changed: string[] = [];
    if (row.asset_kind !== existing.asset_kind) changed.push('asset_kind');
    if (row.content_type !== existing.content_type) changed.push('content_type');
    if (row.byte_size !== existing.byte_size) changed.push('byte_size');
    if (row.width_px !== existing.width_px) changed.push('width_px');
    if (row.height_px !== existing.height_px) changed.push('height_px');
    if (row.font_family !== existing.font_family) changed.push('font_family');
    if (row.original_name !== existing.original_name) changed.push('original_name');
    if (toCell('datetime', row.archived_at) !== toCell('datetime', existing.archived_at)) {
      changed.push('archived_at');
    }
    return changed;
  },

  async upsert(
    row: PrintAssetRow,
    existing: PrintAsset | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PrintAsset> {
    const asset = existing ?? new PrintAsset();
    asset.tenant_id = tenantId;
    asset.asset_kind = row.asset_kind;
    asset.storage_key = row.storage_key;
    asset.content_type = row.content_type;
    asset.byte_size = row.byte_size;
    asset.width_px = row.width_px;
    asset.height_px = row.height_px;
    asset.font_family = row.font_family;
    asset.original_name = row.original_name;
    asset.archived_at = row.archived_at;
    return m.save(PrintAsset, asset);
  },

  async remove(entity: PrintAsset, m: EntityManager): Promise<void> {
    await m.remove(PrintAsset, entity);
  },
};
