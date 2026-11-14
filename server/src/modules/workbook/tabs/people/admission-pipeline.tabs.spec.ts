import { describe, expect, it, vi } from 'vitest';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import { EXPECTED_TABS } from '../../codec/registry';
import {
  admissionFeeProofsTab,
  admissionListMembersTab,
  admissionListsTab,
  admissionPipelineTabs,
  admissionStageResultsTab,
  admissionStagesTab,
} from './admission-pipeline.tabs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SECRET = 'SECRET-KEY-VALUE';

const ctx = (refs: Record<string, string> = {}): ImportContext => ({
  tenantId: TENANT,
  ref: (tab, key) => (refs[`${tab}/${key}`] ? ID : undefined),
  warn: vi.fn<(e: RowError) => void>(),
});

describe('admission pipeline tabs', () => {
  it('apply order puts every parent before its child', () => {
    for (const tab of admissionPipelineTabs) {
      for (const dep of tab.dependsOn) {
        expect(EXPECTED_TABS.indexOf(dep), `${tab.name} after ${dep}`).toBeLessThan(
          EXPECTED_TABS.indexOf(tab.name),
        );
      }
    }
  });

  it('stages: unknown intake is a row error that does not echo the key', () => {
    const result = admissionStagesTab.fromRow(
      { id: ID, intake: SECRET, position: '1', kind: 'WRITTEN', title: '', config: '{}' },
      2,
      ctx(),
    );
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({ column: 'intake', value: SECRET });
    expect(result.errors[0].message).not.toContain(SECRET);
  });

  it('stages: keeps a valid row and rejects a non-object config', () => {
    const refs = { 'admission_intakes/I': ID };
    const base = { id: ID, intake: 'I', position: '2', kind: 'VIVA', title: '' };
    const ok = admissionStagesTab.fromRow({ ...base, config: '{"pass":40}' }, 2, ctx(refs));
    expect(ok).toMatchObject({ row: { position: 2, config: { pass: 40 }, title: null } });
    const bad = admissionStagesTab.fromRow({ ...base, config: '[1]' }, 2, ctx(refs));
    expect('errors' in bad).toBe(true);
  });

  it('stage results: score out of numeric(8,2) range is a row error', () => {
    const refs = { 'admission_stages/S': ID, 'admission_applicants/A': ID };
    const r = admissionStageResultsTab.fromRow(
      { id: ID, stage: 'S', applicant: 'A', score: '1000000', passed: '', remarks: '' },
      2,
      ctx(refs),
    );
    expect('errors' in r && r.errors[0].column).toBe('score');
  });

  it('lists and members: natural keys are built from the parents', () => {
    const list = admissionListsTab.keyOf({
      intake_key: 'I',
      intake: undefined,
      kind: 'MERIT',
      sequence: 2,
    });
    expect(list).toBe('I|MERIT|2');
    expect(admissionListMembersTab.keyOf({ list_key: list, applicant_key: 'A' })).toBe(`${list}|A`);
  });

  it('fee proofs: a key outside the school folder is rejected without echoing it', () => {
    const refs = { 'admission_applicants/A': ID };
    const r = admissionFeeProofsTab.fromRow(
      {
        id: ID,
        applicant: 'A',
        verified_by: '',
        attachment_key: `tenants/${TENANT}/backups/${SECRET}`,
        method: 'BKASH',
        reference: '',
        state: 'AWAITING',
        reason: '',
      },
      2,
      ctx(refs),
    );
    expect('errors' in r).toBe(true);
    if (!('errors' in r)) return;
    expect(r.errors[0]).toMatchObject({ column: 'attachment_key' });
    expect(r.errors[0].message).not.toContain(SECRET);
  });
});
