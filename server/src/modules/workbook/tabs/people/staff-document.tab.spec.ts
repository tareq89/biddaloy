import { describe, expect, it, vi } from 'vitest';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import { StaffDocument } from '../../../staff-hr/entities/staff-document.entity';
import { staffDocumentTab } from './staff-document.tab';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ctx(): ImportContext & { warn: ReturnType<typeof vi.fn> } {
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) =>
      tab === 'users' && key === 'staff@school.test' ? STAFF_USER_ID : undefined,
    warn: vi.fn<(e: RowError) => void>(),
  };
}

function cells(storageKey: string): Record<string, string> {
  return {
    id: '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b',
    staff: 'staff@school.test',
    document_type: 'NID',
    storage_key: storageKey,
    original_filename: 'nid.pdf',
    content_type: 'application/pdf',
  };
}

describe('staffDocumentTab storage_key (DATA-02)', () => {
  it('rejects a key outside tenants/ (platform backup)', () => {
    const result = staffDocumentTab.fromRow(cells('backups/db/x.dump.age'), 2, ctx());
    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'storage_key' });
  });

  it("rewrites another school's key to this school's prefix and warns", () => {
    const c = ctx();
    const result = staffDocumentTab.fromRow(cells('tenants/other-id/staff-documents/a.pdf'), 2, c);
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.storage_key).toBe(`tenants/${TENANT_ID}/staff-documents/a.pdf`);
    expect(c.warn).toHaveBeenCalled();
  });

  it("rejects this school's own key when it is outside the staff-documents/ folder", () => {
    const key = `tenants/${TENANT_ID}/workbook-backups/full.xlsx`;
    const result = staffDocumentTab.fromRow(cells(key), 2, ctx());
    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'storage_key' });
  });

  it('reports an empty storage_key cell once (required), not twice', () => {
    const result = staffDocumentTab.fromRow(cells(''), 2, ctx());
    if (!('errors' in result)) throw new Error('expected errors');
    expect(result.errors.filter((e) => e.column === 'storage_key')).toHaveLength(1);
  });

  it('does not warn about a foreign key when the row is rejected for another reason', () => {
    const c = ctx();
    const result = staffDocumentTab.fromRow(
      { ...cells('tenants/other-id/staff-documents/a.pdf'), staff: 'nobody@school.test' },
      2,
      c,
    );
    expect('errors' in result).toBe(true);
    expect(c.warn).not.toHaveBeenCalled();
  });

  it('keeps an own key without a warning', () => {
    const c = ctx();
    const key = `tenants/${TENANT_ID}/staff-documents/a.pdf`;
    const result = staffDocumentTab.fromRow(cells(key), 2, c);
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.storage_key).toBe(key);
    expect(c.warn).not.toHaveBeenCalled();
  });
});

describe('staffDocumentTab keyOf with a departed staff member (#2668)', () => {
  const ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';

  it('keys a blank staff cell by the row id, the same on the row and the entity branch', () => {
    const result = staffDocumentTab.fromRow({ ...cells('tenants/x/y'), staff: '' }, 2, ctx());
    const row = 'row' in result ? result.row : undefined;
    // storage_key is rejected for the foreign tenant, so build the row by hand.
    const built = row ?? {
      id: ID,
      staff_user_id: null,
      document_type: 'NID',
      storage_key: '',
      original_filename: '',
      content_type: '',
      staff_key: '',
    };
    const entity = Object.assign(new StaffDocument(), { id: ID, document_type: 'NID' });
    expect(staffDocumentTab.keyOf(built as any)).toBe(`#${ID}|NID`);
    expect(staffDocumentTab.keyOf(entity)).toBe(`#${ID}|NID`);
  });

  it('two departed staff with the same document type get different keys', () => {
    const a = Object.assign(new StaffDocument(), { id: 'id-a', document_type: 'NID' });
    const b = Object.assign(new StaffDocument(), { id: 'id-b', document_type: 'NID' });
    expect(staffDocumentTab.keyOf(a)).not.toBe(staffDocumentTab.keyOf(b));
  });

  it('a blank staff cell is accepted by fromRow (the column is required on a new row only)', () => {
    const key = `tenants/${TENANT_ID}/staff-documents/a.pdf`;
    const result = staffDocumentTab.fromRow({ ...cells(key), staff: '' }, 2, ctx());
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.staff_user_id).toBeNull();
  });
});
