import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LEGAL_DOCS, LegalDocument, UserRole } from '@biddaloy/shared';
import { LegalService } from './legal.service';

/** An in-memory stand-in for the repository and the insert builder (ON CONFLICT DO NOTHING). */
function build() {
  const rows: { user_id: string; tenant_id: string; document: string; version: string }[] = [];
  const insert = {
    insert: () => insert,
    values: (v: (typeof rows)[number][]) => {
      insert.pending = v;
      return insert;
    },
    orIgnore: () => insert,
    execute: async () => {
      for (const r of insert.pending) {
        const dup = rows.some(
          (x) =>
            x.user_id === r.user_id &&
            x.tenant_id === r.tenant_id &&
            x.document === r.document &&
            x.version === r.version,
        );
        if (!dup) rows.push(r);
      }
    },
    pending: [] as (typeof rows)[number][],
  };
  const repo = {
    find: async ({ where }: { where: { user_id: string; tenant_id: string } }) =>
      rows.filter((r) => r.user_id === where.user_id && r.tenant_id === where.tenant_id),
    createQueryBuilder: () => insert,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new LegalService(repo as never, audit as never);
  return { service, rows, audit };
}

const ALL3 = [LegalDocument.TERMS, LegalDocument.PRIVACY, LegalDocument.DPA];

describe('LegalService', () => {
  const original = LEGAL_DOCS.terms.version;
  afterEach(() => {
    LEGAL_DOCS.terms.version = original;
  });

  it('a non-admin owes nothing (D7)', async () => {
    const { service } = build();
    expect(await service.pending('u1', 't1', UserRole.TEACHER)).toEqual([]);
  });

  it('an admin with no rows owes terms, privacy and dpa', async () => {
    const { service } = build();
    expect(await service.pending('u1', 't1', UserRole.ADMIN)).toEqual(ALL3);
  });

  it('after accept nothing is owed, and one audit entry is written', async () => {
    const { service, audit } = build();
    await service.accept('u1', 't1', ALL3, '1.2.3.4');
    expect(await service.pending('u1', 't1', UserRole.ADMIN)).toEqual([]);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('a version bump makes the admin owe that document again', async () => {
    const { service } = build();
    await service.accept('u1', 't1', ALL3, null);
    LEGAL_DOCS.terms.version = '2.0';
    expect(await service.pending('u1', 't1', UserRole.ADMIN)).toEqual([LegalDocument.TERMS]);
  });

  it('a duplicate accept is a no-op', async () => {
    const { service, rows } = build();
    await service.accept('u1', 't1', ALL3, null);
    await service.accept('u1', 't1', ALL3, null);
    expect(rows).toHaveLength(3);
  });

  it('acceptance in school A does not clear school B', async () => {
    const { service } = build();
    await service.accept('u1', 'A', ALL3, null);
    expect(await service.pending('u1', 'B', UserRole.ADMIN)).toEqual(ALL3);
  });

  it('an unknown document is a 400 with a fixed sentence that does not echo it', async () => {
    const { service, rows } = build();
    const err = await service.accept('u1', 't1', ['bogus' as never], null).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Unknown legal document');
    expect(rows).toHaveLength(0);
  });
});
