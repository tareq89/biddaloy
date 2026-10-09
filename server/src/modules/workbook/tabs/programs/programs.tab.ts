import type { EntityManager } from 'typeorm';
import { Program } from '../../../programs/entities/program.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `programs` tab (Epic 34.0, [34.1.4]): one row per tenant-wide program
 * (e.g. a hifz or scouting track). Programs aren't year-scoped (D2), so the
 * natural key is just `name`, which also carries the entity's own
 * `(tenant_id, name)` unique index.
 */
export interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  show_on_report_card: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  {
    key: 'is_active',
    type: 'bool',
    required: true,
    label: { en: 'Active', bn: 'সক্রিয়' },
  },
  {
    key: 'show_on_report_card',
    type: 'bool',
    required: true,
    label: { en: 'Show on report card', bn: 'রিপোর্ট কার্ডে দেখান' },
  },
];

export const programsTab: TabSpec<Program, ProgramRow> = {
  name: 'programs',
  entity: Program,
  excluded: [],
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Program[]> {
    return m.find(Program, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Program, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      is_active: entity.is_active,
      show_on_report_card: entity.show_on_report_card,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: ProgramRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'programs', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        description: (values.description as string | null) ?? null,
        is_active: values.is_active as boolean,
        show_on_report_card: values.show_on_report_card as boolean,
      },
    };
  },

  keyOf(x: ProgramRow | Program): string {
    return x.name;
  },

  diffFields(row: ProgramRow, existing: Program): string[] {
    const changed: string[] = [];
    if (row.description !== existing.description) changed.push('description');
    if (row.is_active !== existing.is_active) changed.push('is_active');
    if (row.show_on_report_card !== existing.show_on_report_card) {
      changed.push('show_on_report_card');
    }
    return changed;
  },

  async upsert(
    row: ProgramRow,
    existing: Program | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Program> {
    const program = existing ?? new Program();
    program.tenant_id = tenantId;
    program.name = row.name;
    program.description = row.description;
    program.is_active = row.is_active;
    program.show_on_report_card = row.show_on_report_card;
    return m.save(Program, program);
  },

  async remove(entity: Program, m: EntityManager): Promise<void> {
    await m.remove(Program, entity);
  },
};
