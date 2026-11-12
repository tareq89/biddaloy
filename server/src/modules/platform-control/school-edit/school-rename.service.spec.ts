import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SchoolRenameService } from './school-rename.service';

const ctx = { ip: null, userAgent: null };

function build(school: Record<string, unknown> | null, homeId?: string) {
  const repo = { save: vi.fn(async (s: object) => s) };
  const qb = {
    where: () => qb,
    setLock: () => qb,
    getOne: async () => school,
  };
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => qb, save: repo.save }),
    transaction: async (fn: (m: unknown) => unknown) => fn(manager),
  };
  const audit = { recordApproved: vi.fn() };
  const svc = new SchoolRenameService(
    { manager } as never,
    audit as never,
    { id: async () => homeId } as never,
  );
  return { svc, repo, audit };
}

describe('SchoolRenameService', () => {
  it('unknown school is 404, no write, no audit', async () => {
    const { svc, repo, audit } = build(null);
    await expect(svc.rename('s', { name: 'x', reason: 'r' }, 'a', ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('platform-home is 409 and untouched', async () => {
    const { svc, repo } = build({ id: 's', name: 'P', name_bn: null }, 's');
    await expect(svc.rename('s', { name: 'x', reason: 'r' }, 'a', ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('a change saves and audits old, new and reason', async () => {
    const { svc, audit } = build({ id: 's', name: 'Old', name_bn: null });
    const out = await svc.rename('s', { name: 'New', reason: 'typo' }, 'a', ctx);
    expect(out).toEqual({ name: 'New', name_bn: null, changed: true });
    expect(audit.recordApproved).toHaveBeenCalledTimes(1);
    const entry = audit.recordApproved.mock.calls[0][0];
    expect(entry.action).toBe('PLATFORM_SCHOOL_RENAMED');
    expect(entry.tenant_id).toBe('s');
    expect(entry.old_values).toEqual({ name: 'Old' });
    expect(entry.new_values).toMatchObject({ name: 'New', reason: 'typo' });
  });

  it('a no-change rename writes nothing', async () => {
    const { svc, repo, audit } = build({ id: 's', name: 'Same', name_bn: null });
    const out = await svc.rename('s', { name: 'Same', reason: 'r' }, 'a', ctx);
    expect(out.changed).toBe(false);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });
});
