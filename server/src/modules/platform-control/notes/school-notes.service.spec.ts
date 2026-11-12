import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SchoolNotesService } from './school-notes.service';

const ctx = { ip: null, userAgent: null };

function build(schoolExists = true, note: unknown = null) {
  const repo = {
    save: vi.fn(async (r: object) => ({ ...r, id: 'n1', created_at: new Date() })),
    findOne: vi.fn(async () => note),
    delete: vi.fn(),
  };
  const manager = {
    getRepository: () => repo,
    transaction: async (fn: (m: unknown) => unknown) => fn(manager),
  };
  const audit = { record: vi.fn() };
  const svc = new SchoolNotesService(
    { manager } as never,
    { exist: async () => schoolExists } as never,
    audit as never,
  );
  return { svc, repo, audit };
}

describe('SchoolNotesService', () => {
  it('unknown school is 404 on list, add and remove, with no write and no audit', async () => {
    const { svc, repo, audit } = build(false);
    await expect(svc.list('s')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.add('s', 'x', 'a', ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('s', 'n', 'a', ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('add stores trimmed text and audits id + length, never the text', async () => {
    const { svc, repo, audit } = build();
    await svc.add('s', '  secret words  ', 'a', ctx);
    expect(repo.save).toHaveBeenCalledWith({
      tenant_id: 's',
      author_id: 'a',
      body: 'secret words',
    });
    const entry = audit.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'PLATFORM_SCHOOL_NOTE_ADDED',
      tenant_id: 's',
      new_values: { noteId: 'n1', length: 12 },
    });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('removing a note that is not this school’s is 404, nothing deleted or audited', async () => {
    const { svc, repo, audit } = build(true, null);
    await expect(svc.remove('s', 'n', 'a', ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'n', tenant_id: 's' } });
    expect(repo.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('remove audits deleted=true without the text', async () => {
    const { svc, audit } = build(true, { body: 'private' });
    await svc.remove('s', 'n', 'a', ctx);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.new_values).toEqual({ noteId: 'n', length: 7, deleted: true });
    expect(JSON.stringify(entry)).not.toContain('private');
  });
});
