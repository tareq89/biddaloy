import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrintJobsService } from './print-jobs.service';
import { RESOLVERS } from '../catalog/field-resolver';

const TENANT = 't1';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const TPL = '00000000-0000-4000-8000-0000000000f1';

let copies: Record<string, number>;
let template: any;

function makeManager() {
  return {
    findOne: vi.fn(async () => template),
    findOneByOrFail: vi.fn(async () => ({ id: 'v1', version: 1, definition: {} })),
    create: vi.fn((_e: unknown, x: any) => x),
    save: vi.fn(async (x: any) => ({ id: 'row-' + Math.random(), ...x })),
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('max(copy_number)')) {
        const subjectId = params[2];
        copies[subjectId] = (copies[subjectId] ?? 0) + 1;
        return [{ n: copies[subjectId] }];
      }
      return [];
    }),
  };
}

function setup(kind: 'STUDENT_ID_CARD' | 'STAFF_ID_CARD' = 'STUDENT_ID_CARD') {
  const manager = makeManager();
  const ds: any = { manager, transaction: (fn: any) => fn(manager) };
  const svc = new PrintJobsService(ds, {} as any, { record: vi.fn() } as any);
  // The resolver returns every id except 'foreign' (a subject of another tenant).
  vi.spyOn(RESOLVERS[kind], 'resolve').mockImplementation(
    async (_t, ids) =>
      new Map(
        ids
          .filter((i) => i !== 'foreign')
          .map((i) => [i, { label: 'L' + i, values: {}, photoKey: null }]),
      ),
  );
  return { svc, manager };
}

const caller = { tenantId: TENANT, userId: 'u', role: 'ADMIN' };
const dto = (ids: string[], type: 'STUDENT' | 'STAFF' = 'STUDENT') =>
  ({ template_id: TPL, subject_type: type, subject_ids: ids }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
  copies = {};
  template = {
    id: TPL,
    tenant_id: TENANT,
    document_kind: 'STUDENT_ID_CARD',
    batch_size: 2,
    current_version_id: 'v1',
    archived_at: null,
  };
});

describe('PrintJobsService', () => {
  it('enforces batch_size', async () => {
    const { svc } = setup();
    await expect(svc.create(caller, dto([A, B, C]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s when the template was never published', async () => {
    template.current_version_id = null;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toBeInstanceOf(ConflictException);
  });

  it('403s a staff card for a role without STAFF_HR_READ', async () => {
    template.document_kind = 'STAFF_ID_CARD';
    const { svc } = setup('STAFF_ID_CARD');
    // ACCOUNTANT may print (DOCUMENT_PRINT) but must not read staff HR data.
    await expect(
      svc.create({ ...caller, role: 'ACCOUNTANT' }, dto([A], 'STAFF')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a subject the resolver did not return (another tenant)', async () => {
    const { svc } = setup();
    await expect(svc.create(caller, dto(['foreign']))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('names the template value and the ceiling in batch errors', async () => {
    template.batch_size = 500;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toThrow(/500 exceeds the maximum of 200/);
  });

  it('404s a template that is not in the caller tenant', async () => {
    template = null;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('increments copy numbers across jobs, locks in sorted order, never stores the raw token', async () => {
    const { svc, manager } = setup();
    const first = await svc.create(caller, dto([B, A]));
    const second = await svc.create(caller, dto([A]));

    expect(first.items.map((i: any) => i.subject_id)).toEqual([A, B]);
    expect(second.items[0]).toMatchObject({ subject_id: A, copy_number: 2 });

    const lockKeys = manager.query.mock.calls
      .filter((c) => (c[0] as string).includes('advisory'))
      .map((c) => (c[1] as string[])[0]);
    expect(lockKeys.slice(0, 2)).toEqual([
      `${TENANT}:STUDENT:${A}:STUDENT_ID_CARD`,
      `${TENANT}:STUDENT:${B}:STUDENT_ID_CARD`,
    ]);

    // Only the hash is persisted, so the raw token must appear in no saved row.
    const token = (first.items[0] as any).verify_url.slice('/v/'.length);
    expect(JSON.stringify(manager.save.mock.calls)).not.toContain(token);
  });
});
