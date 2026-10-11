import { describe, expect, it, vi } from 'vitest';
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import { admissionApplicantsTab } from './admission-applicants.tab';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const INTAKE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ctx(): ImportContext & { warn: ReturnType<typeof vi.fn> } {
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) =>
      tab === 'admission_intakes' && key === 'Class Six 2027' ? INTAKE_ID : undefined,
    warn: vi.fn<(e: RowError) => void>(),
  };
}

function cells(documents: unknown[]): Record<string, string> {
  return {
    id: '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b',
    intake: 'Class Six 2027',
    reference_number: 'ADM-2026-ABC123',
    applicant_name: 'Rahim',
    date_of_birth: '2015-01-01',
    gender: 'MALE',
    guardian_name: 'Karim',
    guardian_phone: '01700000001',
    documents: JSON.stringify(documents),
    status: AdmissionApplicantStatus.PENDING,
  };
}

// DATA-02: the public resubmission route deletes a replaced document by its stored
// key, so a restored key outside this school's admission-documents/ folder must
// never be stored.
describe('admissionApplicantsTab documents[].storage_key (DATA-02)', () => {
  it('rejects a document key outside tenants/ (a platform DB backup)', () => {
    const result = admissionApplicantsTab.fromRow(
      cells([{ type: 'PHOTO', storage_key: 'backups/db/x.dump.age' }]),
      2,
      ctx(),
    );
    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'documents' });
  });

  it("rejects this school's own key outside the admission-documents/ folder", () => {
    const result = admissionApplicantsTab.fromRow(
      cells([{ type: 'PHOTO', storage_key: `tenants/${TENANT_ID}/staff-documents/nid.pdf` }]),
      2,
      ctx(),
    );
    expect('errors' in result).toBe(true);
  });

  it("rewrites another school's key to this school's prefix and warns", () => {
    const c = ctx();
    const result = admissionApplicantsTab.fromRow(
      cells([{ type: 'PHOTO', storage_key: 'tenants/other-id/admission-documents/p.jpg' }]),
      2,
      c,
    );
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.documents).toEqual([
      { type: 'PHOTO', storage_key: `tenants/${TENANT_ID}/admission-documents/p.jpg` },
    ]);
    expect(c.warn).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'documents', severity: 'warning' }),
    );
  });

  it('keeps an own key without a warning', () => {
    const c = ctx();
    const doc = { type: 'PHOTO', storage_key: `tenants/${TENANT_ID}/admission-documents/p.jpg` };
    const result = admissionApplicantsTab.fromRow(cells([doc]), 2, c);
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.documents).toEqual([doc]);
    expect(c.warn).not.toHaveBeenCalled();
  });

  it('accepts an empty documents list', () => {
    const result = admissionApplicantsTab.fromRow(cells([]), 2, ctx());
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.documents).toEqual([]);
  });
});
