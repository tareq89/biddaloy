import type { EntityManager } from 'typeorm';
import type { TemplateDefinition } from '@biddaloy/shared';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../print/entities/print-template-version.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { collectAssetRefs, mapAssetRefs } from './asset-refs';
import { templateKeyOf } from './print-templates.tab';

/**
 * The `print_template_versions` tab (32.3.10, D17, D44): every published,
 * immutable version of a template.
 *
 * IMMUTABLE: a database trigger rejects UPDATE on this table, and a published
 * version must never change. So a restore only INSERTS versions. If a row
 * matches an existing version but its content differs, that is an error — never
 * a silent skip and never an update attempt.
 *
 * `is_current` is a sheet-only column (not an entity column): it marks the
 * version its template points at. Templates and versions reference each other,
 * so `print_templates` can't carry the pointer; here, right after inserting the
 * version, `upsert` sets `print_templates.current_version_id` — in the same
 * restore transaction, so there is no deferred "link it later" step to lose.
 *
 * Asset ids inside `definition` are remapped the same way as in the templates
 * tab (see `asset-refs.ts`).
 */
export interface PrintTemplateVersionRow {
  id: string;
  template_id: string;
  template_key: string;
  version: number;
  definition: TemplateDefinition;
  published_at: Date;
  is_current: boolean;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  {
    key: 'template',
    type: 'ref',
    ref: 'print_templates',
    required: true,
    label: label('Template', 'টেমপ্লেট'),
  },
  { key: 'version', type: 'int', required: true, label: label('Version', 'সংস্করণ') },
  { key: 'definition', type: 'json', required: true, label: label('Definition', 'সংজ্ঞা') },
  {
    key: 'published_at',
    type: 'datetime',
    required: true,
    label: label('Published at', 'প্রকাশের সময়'),
  },
  {
    key: 'is_current',
    type: 'bool',
    required: true,
    label: label('Current version', 'বর্তমান সংস্করণ'),
  },
];

const excluded: readonly string[] = [
  'template_id', // exported instead as the `template` ref column
  'published_by', // audit "who published" field, not needed for restore fidelity
];

export const printTemplateVersionsTab: TabSpec<PrintTemplateVersion, PrintTemplateVersionRow> = {
  name: 'print_template_versions',
  entity: PrintTemplateVersion,
  excluded,
  dependsOn: ['print_templates', 'print_assets'],
  columns,
  naturalKey: ['template', 'version'],
  // Published versions are history that job snapshots refer to; a restore never removes one.
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<PrintTemplateVersion[]> {
    return m.find(PrintTemplateVersion, {
      where: { tenant_id: tenantId },
      relations: ['template'],
    });
  },

  toRow(entity: PrintTemplateVersion, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      template: ctx.keyOf('print_templates', entity.template_id),
      version: entity.version,
      definition: mapAssetRefs(entity.definition, (id) => ctx.keyOf('print_assets', id)),
      published_at: entity.published_at,
      is_current: entity.template?.current_version_id === entity.id,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PrintTemplateVersionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'print_template_versions', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const templateKey = v.template as string;
    const templateId = ctx.ref('print_templates', templateKey);
    if (!templateId) {
      errors.push({
        tab: 'print_template_versions',
        row: rowNo,
        column: 'template',
        message: `Column "template": no template with the key "${templateKey}" was found.`,
        severity: 'error',
        value: templateKey,
      });
    }
    const unresolved = collectAssetRefs(v.definition).filter(
      (key) => ctx.ref('print_assets', key) === undefined,
    );
    for (const key of new Set(unresolved)) {
      errors.push({
        tab: 'print_template_versions',
        row: rowNo,
        column: 'definition',
        message: `Column "definition": no asset with the key "${key}" was found.`,
        severity: 'error',
        value: key,
      });
    }
    if (errors.length > 0 || !templateId) return { errors };

    return {
      row: {
        id: v.id as string,
        template_id: templateId,
        template_key: templateKey,
        version: v.version as number,
        definition: mapAssetRefs(
          v.definition,
          (key) => ctx.ref('print_assets', key) as string,
        ) as TemplateDefinition,
        published_at: v.published_at as Date,
        is_current: v.is_current as boolean,
      },
    };
  },

  keyOf(x: PrintTemplateVersionRow | PrintTemplateVersion): string {
    if (x instanceof PrintTemplateVersion) {
      return `${x.template ? templateKeyOf(x.template) : ''}|${x.version}`;
    }
    return `${x.template_key}|${x.version}`;
  },

  diffFields(row: PrintTemplateVersionRow, existing: PrintTemplateVersion): string[] {
    // Only the content matters: a version's published_at / id are not part of "has it changed".
    return JSON.stringify(row.definition) === JSON.stringify(existing.definition)
      ? []
      : ['definition'];
  },

  async upsert(
    row: PrintTemplateVersionRow,
    existing: PrintTemplateVersion | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PrintTemplateVersion> {
    let version: PrintTemplateVersion;
    if (existing) {
      // Published versions never change (D17; DB trigger). Different content is a hard error.
      if (JSON.stringify(row.definition) !== JSON.stringify(existing.definition)) {
        throw new Error(
          `Cannot restore print template version ${row.template_key} v${row.version}: ` +
            'a published version is immutable and this workbook holds different content for it.',
        );
      }
      version = existing;
    } else {
      version = new PrintTemplateVersion();
      version.tenant_id = tenantId;
      version.template_id = row.template_id;
      version.version = row.version;
      version.definition = row.definition;
      version.published_at = row.published_at;
      version = await m.save(PrintTemplateVersion, version);
    }

    // The circular link, closed in the same transaction as the insert.
    if (row.is_current) {
      await m.update(
        PrintTemplate,
        { id: row.template_id, tenant_id: tenantId },
        { current_version_id: version.id },
      );
    }
    return version;
  },

  async remove(_entity: PrintTemplateVersion, _m: EntityManager): Promise<void> {
    // Unreachable while `deleteByAbsence` is false; refuse loudly if that ever changes.
    throw new Error('Published print template versions are immutable and cannot be removed.');
  },
};
