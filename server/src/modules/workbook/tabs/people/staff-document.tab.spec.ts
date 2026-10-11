import { describe, expect, it, vi } from 'vitest';
import type { ImportContext, RowError } from '../../codec/tab-spec';
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

  it('keeps an own key without a warning', () => {
    const c = ctx();
    const key = `tenants/${TENANT_ID}/staff-documents/a.pdf`;
    const result = staffDocumentTab.fromRow(cells(key), 2, c);
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.storage_key).toBe(key);
    expect(c.warn).not.toHaveBeenCalled();
  });
});
