import { describe, expect, it, vi } from 'vitest';
import { ensureDocumentsSeed, type DocumentsSeedRepositories } from './seed.documents';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

type Row = Record<string, unknown>;

/** Minimal in-memory repo: findOne by equality. */
function repo(rows: Row[]) {
  return {
    rows,
    findOne: ({ where }: { where: Row }) =>
      Promise.resolve(
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      ),
  };
}

describe('ensureDocumentsSeed [48.2.15]', () => {
  it('creates the templates and the two certificates once, then nothing', async () => {
    const templates = repo([]);
    const items = repo([]);
    const students = repo(
      [2, 3].map((n) => ({
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
          tenant_id: 't1',
          subject_id: studentId,
          document_kind: studentId === 's2' ? 'TRANSFER_CERTIFICATE' : 'TESTIMONIAL',
        });
        return Promise.resolve({ job_id: `job-${studentId}` });
      }),
      confirmJob: vi.fn(() => Promise.resolve()),
    };
    const repos = {
      printTemplateRepository: templates,
      printJobItemRepository: items,
      studentRepository: students,
    } as unknown as DocumentsSeedRepositories;

    expect(await ensureDocumentsSeed(repos, ports, 't1')).toEqual({
      templates: 4,
      certificates: 2,
    });
    expect(await ensureDocumentsSeed(repos, ports, 't1')).toEqual({
      templates: 0,
      certificates: 0,
    });
    expect(created).toEqual(['admit-card-bn', 'tc-a4-bn', 'testimonial-a4-bn', 'character-a4-bn']);
    expect(ports.confirmJob).toHaveBeenCalledTimes(2);
  });
});
