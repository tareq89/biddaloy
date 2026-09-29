import type { EntityManager } from 'typeorm';
import { DuplexOrder, PrinterType } from '@biddaloy/shared';
import { PrinterProfile } from '../../../print/entities/printer-profile.entity';
import { fromCell, toCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `printer_profiles` tab (32.3.10, D44): a school's printers and their
 * calibration (margins, offset, scale, duplex order, cutting gap). Every column.
 *
 * The numeric columns are Postgres `numeric` (strings on the entity). They are
 * exported as text and checked on import against the same bounds the API uses,
 * so a hand-edited workbook can't slip in an offset of 100 mm.
 */
export interface PrinterProfileRow {
  id: string;
  name: string;
  printer_type: PrinterType;
  margin_top_mm: string;
  margin_right_mm: string;
  margin_bottom_mm: string;
  margin_left_mm: string;
  offset_x_mm: string;
  offset_y_mm: string;
  scale: string;
  duplex_order: DuplexOrder;
  sheet_gap_mm: string;
  archived_at: Date | null;
}

const NUMERIC_KEYS = [
  'margin_top_mm',
  'margin_right_mm',
  'margin_bottom_mm',
  'margin_left_mm',
  'offset_x_mm',
  'offset_y_mm',
  'scale',
  'sheet_gap_mm',
] as const;
type NumericKey = (typeof NUMERIC_KEYS)[number];

/** [min, max] per numeric column — mirrors `CreatePrinterProfileDto`. */
const BOUNDS: Record<NumericKey, [number, number]> = {
  margin_top_mm: [0, 20],
  margin_right_mm: [0, 20],
  margin_bottom_mm: [0, 20],
  margin_left_mm: [0, 20],
  offset_x_mm: [-10, 10],
  offset_y_mm: [-10, 10],
  scale: [0.9, 1.1],
  sheet_gap_mm: [0, 20],
};

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  { key: 'name', type: 'string', required: true, label: label('Name', 'নাম') },
  {
    key: 'printer_type',
    type: 'enum',
    required: true,
    enumValues: Object.values(PrinterType),
    label: label('Type', 'ধরন'),
  },
  {
    key: 'margin_top_mm',
    type: 'string',
    required: true,
    label: label('Margin top (mm)', 'ওপরের মার্জিন (মিমি)'),
  },
  {
    key: 'margin_right_mm',
    type: 'string',
    required: true,
    label: label('Margin right (mm)', 'ডানের মার্জিন (মিমি)'),
  },
  {
    key: 'margin_bottom_mm',
    type: 'string',
    required: true,
    label: label('Margin bottom (mm)', 'নিচের মার্জিন (মিমি)'),
  },
  {
    key: 'margin_left_mm',
    type: 'string',
    required: true,
    label: label('Margin left (mm)', 'বাঁয়ের মার্জিন (মিমি)'),
  },
  {
    key: 'offset_x_mm',
    type: 'string',
    required: true,
    label: label('Offset X (mm)', 'অফসেট X (মিমি)'),
  },
  {
    key: 'offset_y_mm',
    type: 'string',
    required: true,
    label: label('Offset Y (mm)', 'অফসেট Y (মিমি)'),
  },
  { key: 'scale', type: 'string', required: true, label: label('Scale', 'স্কেল') },
  {
    key: 'duplex_order',
    type: 'enum',
    required: true,
    enumValues: Object.values(DuplexOrder),
    label: label('Duplex order', 'দুই পাশে ছাপার ক্রম'),
  },
  {
    key: 'sheet_gap_mm',
    type: 'string',
    required: true,
    label: label('Cutting gap (mm)', 'কাটার ফাঁক (মিমি)'),
  },
  { key: 'archived_at', type: 'datetime', label: label('Archived at', 'আর্কাইভের সময়') },
];

export const printerProfilesTab: TabSpec<PrinterProfile, PrinterProfileRow> = {
  name: 'printer_profiles',
  entity: PrinterProfile,
  excluded: [],
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  // Past print jobs record which printer they used; a restore never deletes one.
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<PrinterProfile[]> {
    return m.find(PrinterProfile, { where: { tenant_id: tenantId } });
  },

  toRow(entity: PrinterProfile, _ctx: ExportContext): Record<string, unknown> {
    const row: Record<string, unknown> = {
      id: entity.id,
      name: entity.name,
      printer_type: entity.printer_type,
      duplex_order: entity.duplex_order,
      archived_at: entity.archived_at,
    };
    for (const key of NUMERIC_KEYS) row[key] = String(entity[key]);
    return row;
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: PrinterProfileRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'printer_profiles', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    for (const key of NUMERIC_KEYS) {
      const [min, max] = BOUNDS[key];
      const n = Number(v[key]);
      if (v[key] !== undefined && (!Number.isFinite(n) || n < min || n > max)) {
        errors.push({
          tab: 'printer_profiles',
          row: rowNo,
          column: key,
          message: `Column "${key}": "${String(v[key])}" must be a number between ${min} and ${max}.`,
          severity: 'error',
          value: String(v[key]),
        });
      }
    }
    if (errors.length > 0) return { errors };

    return {
      row: {
        id: v.id as string,
        name: v.name as string,
        printer_type: v.printer_type as PrinterType,
        margin_top_mm: String(v.margin_top_mm),
        margin_right_mm: String(v.margin_right_mm),
        margin_bottom_mm: String(v.margin_bottom_mm),
        margin_left_mm: String(v.margin_left_mm),
        offset_x_mm: String(v.offset_x_mm),
        offset_y_mm: String(v.offset_y_mm),
        scale: String(v.scale),
        duplex_order: v.duplex_order as DuplexOrder,
        sheet_gap_mm: String(v.sheet_gap_mm),
        archived_at: (v.archived_at as Date | undefined) ?? null,
      },
    };
  },

  keyOf(x: PrinterProfileRow | PrinterProfile): string {
    return x.name;
  },

  diffFields(row: PrinterProfileRow, existing: PrinterProfile): string[] {
    const changed: string[] = [];
    if (row.printer_type !== existing.printer_type) changed.push('printer_type');
    if (row.duplex_order !== existing.duplex_order) changed.push('duplex_order');
    // `numeric` comes back as "5.00" vs the cell's "5": compare as numbers.
    for (const key of NUMERIC_KEYS) {
      if (Number(row[key]) !== Number(existing[key])) changed.push(key);
    }
    if (toCell('datetime', row.archived_at) !== toCell('datetime', existing.archived_at)) {
      changed.push('archived_at');
    }
    return changed;
  },

  async upsert(
    row: PrinterProfileRow,
    existing: PrinterProfile | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PrinterProfile> {
    const printer = existing ?? new PrinterProfile();
    printer.tenant_id = tenantId;
    printer.name = row.name;
    printer.printer_type = row.printer_type;
    printer.duplex_order = row.duplex_order;
    printer.archived_at = row.archived_at;
    for (const key of NUMERIC_KEYS) printer[key] = row[key];
    return m.save(PrinterProfile, printer);
  },

  async remove(entity: PrinterProfile, m: EntityManager): Promise<void> {
    await m.remove(PrinterProfile, entity);
  },
};
