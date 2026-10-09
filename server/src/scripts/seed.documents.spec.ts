import { FindOperator } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ensureDocumentsSeed, type DocumentsSeedRepositories } from './seed.documents';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

type Row = Record<string, unknown>;

/** Minimal in-memory repo: findOne by equality, `IsNull()` matching null/undefined. */
const matches = (actual: unknown, want: unknown) =>
  want instanceof FindOperator && want.type === 'isNull' ? actual == null : actual === want;
function repo(rows: Row[]) {
  return {
    rows,
    findOne: ({ where }: { where: Row }) =>
      Promise.resolve(
        rows.find((r) => Object.entries(where).every(([k, v]) => matches(r[k], v))) ?? null,
      ),
  };
}

describe('ensureDocumentsSeed [48.2.15]', () => {
  it('creates the templates and the two certificates once, then nothing', async () => {
    const templates = repo([]);
    const items = repo([]);
    const students = repo(
      [2, 3, 4].map((n) => ({
        id: `s${n}`,
        tenant_id: 't1',
        registration_number: `${DEMO_ACADEMIC_YEAR.name}-000${n}`,
      })),
    );
    let seq = 0;
    const created: string[] = [];
    const ports = {
      createTemplate: vi.fn((key: string, name: string) => {
        const id = `tpl-${(seq += 1)}`;
        created.push(key);
        templates.rows.push({ id, tenant_id: 't1', name, current_version_id: null });
        return Promise.resolve({ id });
      }),
      publishTemplate: vi.fn((id: string) => {
        templates.rows.find((r) => r.id === id)!.current_version_id = 'v1';
        return Promise.resolve();
      }),
      setDefaultTemplate: vi.fn(() => Promise.resolve()),
      issueCertificate: vi.fn(({ studentId }: { studentId: string }) => {
        items.rows.push({
          id: `item-${studentId}`,
          tenant_id: 't1',
          subject_id: studentId,
          document_kind: studentId === 's2' ? 'TRANSFER_CERTIFICATE' : 'TESTIMONIAL',
        });
        return Promise.resolve({ job_id: `job-${studentId}` });
      }),
      confirmJob: vi.fn(() => Promise.resolve()),
      revokeItem: vi.fn((id: string) => {
        items.rows.find((r) => r.id === id)!.revoked_at = new Date();
        return Promise.resolve();
      }),
    };
    const repos = {
      printTemplateRepository: templates,
      printJobItemRepository: items,
      studentRepository: students,
    } as unknown as DocumentsSeedRepositories;

    expect(await ensureDocumentsSeed(repos, ports, 't1')).toEqual({
      templates: 6,
      certificates: 3,
      revoked: 1,
    });
    expect(await ensureDocumentsSeed(repos, ports, 't1')).toEqual({
      templates: 0,
      certificates: 0,
      revoked: 0,
    });
    expect(created).toEqual([
      'admit-card-bn',
      'tc-a4-bn',
      'testimonial-a4-bn',
      'character-a4-bn',
      'result-a4-bn',
      'merit-a4-bn',
    ]);
    expect(ports.confirmJob).toHaveBeenCalledTimes(3);
    expect(ports.revokeItem).toHaveBeenCalledTimes(1);
  });

  it('ignores an archived template of the same name and issues against a fresh one', async () => {
    // The archived TC can no longer print; reusing its id made jobs.create 404 and the seed abort.
    const templates = repo([
      {
        id: 'old-tc',
        tenant_id: 't1',
        name: 'Transfer certificate (A4, Bangla)',
        current_version_id: 'v0',
        archived_at: new Date(),
      },
    ]);
    const items = repo([]);
    const students = repo([
      { id: 's2', tenant_id: 't1', registration_number: `${DEMO_ACADEMIC_YEAR.name}-0002` },
    ]);
    let seq = 0;
    const ports = {
      createTemplate: vi.fn((_key: string, name: string) => {
        const id = `tpl-${(seq += 1)}`;
        templates.rows.push({ id, tenant_id: 't1', name, current_version_id: 'v1' });
        return Promise.resolve({ id });
      }),
      publishTemplate: vi.fn(() => Promise.resolve()),
      setDefaultTemplate: vi.fn(() => Promise.resolve()),
      issueCertificate: vi.fn(() => Promise.resolve({ job_id: 'job-1' })),
      confirmJob: vi.fn(() => Promise.resolve()),
      revokeItem: vi.fn(() => Promise.resolve()),
    };
    const repos = {
      printTemplateRepository: templates,
      printJobItemRepository: items,
      studentRepository: students,
    } as unknown as DocumentsSeedRepositories;

    await ensureDocumentsSeed(repos, ports, 't1');
    const used = ports.issueCertificate.mock.calls.map(
      (c) => (c as unknown as [{ templateId: string }])[0].templateId,
    );
    expect(used).not.toContain('old-tc');
    expect(used.length).toBeGreaterThan(0);
  });

  it('revokes the demo testimonial left unrevoked by an earlier run, without issuing again', async () => {
    const templates = repo(
      ['Testimonial (A4, Bangla)'].map((name) => ({
        id: 'tpl-tm',
        tenant_id: 't1',
        name,
        current_version_id: 'v1',
      })),
    );
    // Issued by a run that stopped before the revoke.
    const items = repo([
      { id: 'item-s4', tenant_id: 't1', subject_id: 's4', document_kind: 'TESTIMONIAL' },
    ]);
    const students = repo([
      { id: 's4', tenant_id: 't1', registration_number: `${DEMO_ACADEMIC_YEAR.name}-0004` },
    ]);
    const ports = {
      createTemplate: vi.fn((_key: string, name: string) => {
        templates.rows.push({ id: name, tenant_id: 't1', name, current_version_id: 'v1' });
        return Promise.resolve({ id: name });
      }),
      publishTemplate: vi.fn(() => Promise.resolve()),
      setDefaultTemplate: vi.fn(() => Promise.resolve()),
      issueCertificate: vi.fn(() => Promise.resolve({ job_id: 'job-1' })),
      confirmJob: vi.fn(() => Promise.resolve()),
      revokeItem: vi.fn(() => Promise.resolve()),
    };
    const repos = {
      printTemplateRepository: templates,
      printJobItemRepository: items,
      studentRepository: students,
    } as unknown as DocumentsSeedRepositories;

    const result = await ensureDocumentsSeed(repos, ports, 't1');
    expect(result).toMatchObject({ certificates: 0, revoked: 1 });
    expect(ports.issueCertificate).not.toHaveBeenCalled();
    expect(ports.revokeItem).toHaveBeenCalledWith('item-s4', expect.any(String));
  });
});
