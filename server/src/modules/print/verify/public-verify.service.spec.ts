import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { hashSecret } from '../../auth/token-hash.util';
import { PUBLIC_VERIFY_FIELDS, PublicVerifyService } from './public-verify.service';

const row = (over: Record<string, unknown> = {}) => ({
  document_kind: 'STUDENT_ID_CARD',
  subject_label: 'Rahim',
  copy_number: 1,
  revoked_at: null,
  issued_at: '2027-03-01T00:00:00.000Z',
  school_name: 'Biddaloy High',
  school_name_bn: null,
  // Columns the service must never pass through, even if a future query selects them.
  subject_id: 'secret-id',
  tenant_id: 'secret-tenant',
  data_snapshot: { photoKey: 'secret' },
  ...over,
});

const make = (rows: unknown[]) => {
  const query = vi.fn(async () => rows);
  return { svc: new PublicVerifyService({ query } as any), query };
};

describe('PublicVerifyService', () => {
  it('returns exactly the allowlisted keys (D22): no ids, photo, class or phone', async () => {
    const { svc } = make([row()]);
    const res = await svc.verify('tok');
    // This is the guard: adding a field here must be a deliberate, reviewed change.
    expect(Object.keys(res).sort()).toEqual([...PUBLIC_VERIFY_FIELDS].sort());
    expect(res.status).toBe('VALID');
    expect(res.holder_name).toBe('Rahim');
  });

  it('a revoked document reports REVOKED with the time it was revoked', async () => {
    const { svc } = make([row({ revoked_at: '2027-03-02T00:00:00.000Z' })]);
    const res = await svc.verify('tok');
    expect(res.status).toBe('REVOKED');
    expect(res.revoked_at).toBe('2027-03-02T00:00:00.000Z');
    expect(Object.keys(res).sort()).toEqual([...PUBLIC_VERIFY_FIELDS, 'revoked_at'].sort());
  });

  it('an unknown token is a 404', async () => {
    const { svc } = make([]);
    await expect(svc.verify('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('looks the token up by its hash, never the raw value', async () => {
    const { svc, query } = make([row()]);
    await svc.verify('raw-token');
    expect((query.mock.calls[0] as unknown[])[1]).toEqual([hashSecret('raw-token')]);
  });
});
