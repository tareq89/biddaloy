import type { EntityManager } from 'typeorm';
import { DocumentKind, LayoutKind, type TemplateDefinition } from '@biddaloy/shared';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { fromCell, toCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { collectAssetRefs, mapAssetRefs } from './asset-refs';

/**
 * The `print_templates` tab (32.3.10, D44): a template and its editable draft.
 *
 * IDS: a restore inserts NEW rows with fresh UUIDs (the codec never carries an
 * id over for a new row). So the asset ids inside the `draft` JSON would dangle;
 * on export they become the asset's tenant-independent key and on import they
 * are looked up again (`asset-refs.ts`). Any that can't be found is a row error,
 * so a restored template never points at another school's asset (or at nothing).
 *
 * `current_version_id` is NOT a column here. Templates and versions point at
 * each other, so the pointer is restored by the versions tab (`is_current`) in
 * the same transaction, right after the version row exists.
 *
 * The one default per kind: restoring a default template first clears any other
 * default of the same kind, so the partial unique index can't reject the restore.
 */
export interface PrintTemplateRow {
  id: string;
  document_kind: DocumentKind;
  layout_kind: LayoutKind;
  name: string;
  is_default: boolean;
  batch_size: number;
  draft: TemplateDefinition;
  archived_at: Date | null;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  {
    key: 'document_kind',
    type: 'enum',
    required: true,
    enumValues: Object.values(DocumentKind),
    label: label('Document kind', 'নথির ধরন'),
  },
  {
    key: 'layout_kind',
    type: 'enum',
    required: true,
    enumValues: Object.values(LayoutKind),
    label: label('Layout', 'লেআউট'),
  },
  { key: 'name', type: 'string', required: true, label: label('Name', 'নাম') },
  { key: 'is_default', type: 'bool', required: true, label: label('Default', 'ডিফল্ট') },
  { key: 'batch_size', type: 'int', required: true, label: label('Batch size', 'ব্যাচের আকার') },
  { key: 'draft', type: 'json', required: true, label: label('Draft', 'খসড়া') },
  { key: 'archived_at', type: 'datetime', label: label('Archived at', 'আর্কাইভের সময়') },
];

const excluded: readonly string[] = [
  'current_version_id', // restored by print_template_versions (is_current), same transaction
  'created_by', // audit "who created" field, not needed for restore fidelity
];

/** `<kind>|<name>` — also what the versions tab uses to point at its template. */
export const templateKeyOf = (t: { document_kind: string; name: string }): string =>
  `${t.document_kind}|${t.name}`;

export const printTemplatesTab: TabSpec<PrintTemplate, PrintTemplateRow> = {
  name: 'print_templates',
  entity: PrintTemplate,
  excluded,
  dependsOn: ['print_assets'],
  columns,
  naturalKey: ['document_kind', 'name'],
  // Published versions (immutable) and print jobs hang off a template.
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<PrintTemplate[]> {
    return m.find(PrintTemplate, { where: { tenant_id: tenantId } });
  },

  toRow(entity: PrintTemplate, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      document_kind: entity.document_kind,
      layout_kind: entity.layout_kind,
      name: entity.name,
      is_default: entity.is_default,
      batch_size: entity.batch_size,
      draft: mapAssetRefs(entity.draft, (id) => ctx.keyOf('print_assets', id)),
      archived_at: entity.archived_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PrintTemplateRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'print_templates', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const missing = collectAssetRefs(v.draft).filter(
      (key) => ctx.ref('print_assets', key) === undefined,
    );
    for (const key of new Set(missing)) {
      errors.push({
        tab: 'print_templates',
        row: rowNo,
        column: 'draft',
        message: `Column "draft": no asset with the key "${key}" was found.`,
        severity: 'error',
        value: key,
      });
    }
    if (errors.length > 0) return { errors };

    return {
      row: {
        id: v.id as string,
        document_kind: v.document_kind as DocumentKind,
        layout_kind: v.layout_kind as LayoutKind,
        name: v.name as string,
        is_default: v.is_default as boolean,
        batch_size: v.batch_size as number,
        draft: mapAssetRefs(
          v.draft,
          (key) => ctx.ref('print_assets', key) as string,
        ) as TemplateDefinition,
        archived_at: (v.archived_at as Date | undefined) ?? null,
      },
    };
  },

  keyOf(x: PrintTemplateRow | PrintTemplate): string {
    return templateKeyOf(x);
  },

  diffFields(row: PrintTemplateRow, existing: PrintTemplate): string[] {
    const changed: string[] = [];
    if (row.layout_kind !== existing.layout_kind) changed.push('layout_kind');
    if (row.is_default !== existing.is_default) changed.push('is_default');
    if (row.batch_size !== existing.batch_size) changed.push('batch_size');
    if (JSON.stringify(row.draft) !== JSON.stringify(existing.draft)) changed.push('draft');
    if (toCell('datetime', row.archived_at) !== toCell('datetime', existing.archived_at)) {
      changed.push('archived_at');
    }
    return changed;
  },

  async upsert(
    row: PrintTemplateRow,
    existing: PrintTemplate | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PrintTemplate> {
    const template = existing ?? new PrintTemplate();
    template.tenant_id = tenantId;
    template.document_kind = row.document_kind;
    template.layout_kind = row.layout_kind;
    template.name = row.name;
    template.batch_size = row.batch_size;
    template.draft = row.draft;
    template.archived_at = row.archived_at;
    // A new template starts with no published version; the versions tab sets the pointer.
    if (!existing) template.current_version_id = null;

    // At most one non-archived default per kind: clear the others before setting this one.
    if (row.is_default && !row.archived_at) {
      await m
        .createQueryBuilder()
        .update(PrintTemplate)
        .set({ is_default: false })
        .where('tenant_id = :tenantId AND document_kind = :kind AND is_default = true', {
          tenantId,
          kind: row.document_kind,
        })
        .andWhere(existing ? 'id != :id' : '1=1', { id: existing?.id })
        .execute();
    }
    template.is_default = row.is_default;
    return m.save(PrintTemplate, template);
  },

  async remove(entity: PrintTemplate, m: EntityManager): Promise<void> {
    await m.remove(PrintTemplate, entity);
  },
};
