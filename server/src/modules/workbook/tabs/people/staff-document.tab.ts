import type { EntityManager } from 'typeorm';
import { StaffDocumentType } from '@biddaloy/shared';
import { StaffDocument } from '../../../staff-hr/entities/staff-document.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { usersTab } from './users.tab';

/**
 * The `staff_documents` tab (23.7): one uploaded HR document per staff
 * member per type. Like every other S3-backed workbook tab in this
 * codebase (e.g. `homework_submissions`' `attachments`), a backup carries
 * only `storage_key` **metadata** — the object it points at in
 * `StorageService`, not the file bytes. Restoring a workbook therefore
 * recreates the row, but the S3 object it references must already exist
 * (or be re-uploaded) at the destination; that's an accepted limitation of
 * every attachment-carrying tab, not new to this one.
 *
 * `uploaded_by_user_id` is left out: it's an audit "who did this" field
 * (`AuditLog`/`AuthToken`'s pattern per the entity's own comment), not
 * data a restore needs to reproduce document fidelity.
 */
export interface StaffDocumentRow {
  id: string;
  staff_user_id: string;
  document_type: StaffDocumentType;
  storage_key: string;
  original_filename: string;
  content_type: string;
  staff_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'staff', type: 'ref', ref: 'users', required: true, label: { en: 'Staff', bn: 'কর্মী' } },
  {
    key: 'document_type',
    type: 'enum',
    required: true,
    enumValues: Object.values(StaffDocumentType),
    label: { en: 'Document type', bn: 'দলিলের ধরন' },
  },
  {
    key: 'storage_key',
    type: 'string',
    required: true,
    label: { en: 'Storage key', bn: 'সংরক্ষণ কী' },
  },
  {
    key: 'original_filename',
    type: 'string',
    required: true,
    label: { en: 'Original filename', bn: 'মূল ফাইলের নাম' },
  },
  {
    key: 'content_type',
    type: 'string',
    required: true,
    label: { en: 'Content type', bn: 'বিষয়বস্তুর ধরন' },
  },
];

const excluded: readonly string[] = [
  'staff_user_id', // exported instead as the `staff` ref column
  'uploaded_by_user_id', // audit "who uploaded" field, not needed for restore fidelity
];

export const staffDocumentTab: TabSpec<StaffDocument, StaffDocumentRow> = {
  name: 'staff_documents',
  entity: StaffDocument,
  excluded,
  dependsOn: ['users'],
  columns,
  naturalKey: ['staff', 'document_type'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StaffDocument[]> {
    return m.find(StaffDocument, {
      where: { tenant_id: tenantId },
      relations: ['staff_user'],
    });
  },

  toRow(entity: StaffDocument, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      staff: ctx.keyOf('users', entity.staff_user_id),
      document_type: entity.document_type,
      storage_key: entity.storage_key,
      original_filename: entity.original_filename,
      content_type: entity.content_type,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StaffDocumentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'staff_documents', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const staffKey = values.staff as string;
    const staffUserId = ctx.ref('users', staffKey);
    if (!staffUserId) {
      errors.push({
        tab: 'staff_documents',
        row: rowNo,
        column: 'staff',
        message: `Column "staff": no user with the key "${staffKey}" was found.`,
        severity: 'error',
        value: staffKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        staff_user_id: staffUserId as string,
        document_type: values.document_type as StaffDocumentType,
        storage_key: values.storage_key as string,
        original_filename: values.original_filename as string,
        content_type: values.content_type as string,
        staff_key: staffKey,
      },
    };
  },

  keyOf(x: StaffDocumentRow | StaffDocument): string {
    const staffKey =
      x instanceof StaffDocument ? (x.staff_user ? usersTab.keyOf(x.staff_user) : '') : x.staff_key;
    return `${staffKey}|${x.document_type}`;
  },

  diffFields(row: StaffDocumentRow, existing: StaffDocument): string[] {
    const changed: string[] = [];
    if (row.storage_key !== existing.storage_key) changed.push('storage_key');
    if (row.original_filename !== existing.original_filename) changed.push('original_filename');
    if (row.content_type !== existing.content_type) changed.push('content_type');
    return changed;
  },

  async upsert(
    row: StaffDocumentRow,
    existing: StaffDocument | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StaffDocument> {
    const doc = existing ?? new StaffDocument();
    doc.tenant_id = tenantId;
    doc.staff_user_id = row.staff_user_id;
    doc.document_type = row.document_type;
    doc.storage_key = row.storage_key;
    doc.original_filename = row.original_filename;
    doc.content_type = row.content_type;
    return m.save(StaffDocument, doc);
  },

  async remove(entity: StaffDocument, m: EntityManager): Promise<void> {
    await m.remove(StaffDocument, entity);
  },
};
