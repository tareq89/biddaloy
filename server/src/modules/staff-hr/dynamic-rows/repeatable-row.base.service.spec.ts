import { describe, it, expect, vi } from 'vitest';
import { RepeatableRowBaseService } from './repeatable-row.base.service';

/**
 * Unit tests for [23.3]'s `RepeatableRowBaseService.replaceRows`: it must
 * delete-then-insert only the target `(staff_user_id, tenant_id)` set,
 * never touch another staff member's or tenant's rows, and clear
 * everything on an empty array — all inside one transaction (the
 * incident this invariant guards against: a bare `save()` on a
 * tenant-filtered loaded collection NULLs other tenants' FKs instead of
 * leaving them alone).
 */

interface Row {
  id: string;
  staff_user_id: string;
  tenant_id: string;
  name: string;
}

function createFakeRepo(seed: Row[]) {
  let rows = [...seed];
  let nextId = 100;

  const repoApi = {
    find: vi.fn(async ({ where }: any) =>
      rows.filter(
        (r) => r.staff_user_id === where.staff_user_id && r.tenant_id === where.tenant_id,
      ),
    ),
    delete: vi.fn(async (criteria: any) => {
      rows = rows.filter(
        (r) => !(r.staff_user_id === criteria.staff_user_id && r.tenant_id === criteria.tenant_id),
      );
    }),
    create: vi.fn((partial: any) => ({ id: `row-${nextId++}`, ...partial }) as Row),
    save: vi.fn(async (entities: Row[]) => {
      rows.push(...entities);
      return entities;
    }),
  };

  const repo: any = {
    ...repoApi,
    target: 'Row',
    manager: {
      transaction: vi.fn(async (fn: (manager: any) => Promise<unknown>) => {
        const manager = { getRepository: () => repoApi };
        return fn(manager);
      }),
    },
  };
  return { repo, getRows: () => rows };
}

class TestRowService extends RepeatableRowBaseService<Row> {
  constructor(repo: any) {
    super(repo);
  }
}

describe('RepeatableRowBaseService.replaceRows', () => {
  it('deletes only the target staff member/tenant rows, leaves others untouched', async () => {
    const { repo, getRows } = createFakeRepo([
      { id: 'r1', staff_user_id: 'staff-1', tenant_id: 'tenant-a', name: 'old-1' },
      // Same staff id but a DIFFERENT tenant — must survive untouched.
      { id: 'r2', staff_user_id: 'staff-1', tenant_id: 'tenant-b', name: 'other-tenant' },
      // A different staff member in the same tenant — must survive untouched.
      { id: 'r3', staff_user_id: 'staff-2', tenant_id: 'tenant-a', name: 'other-staff' },
    ]);
    const service = new TestRowService(repo);

    const result = await service.replaceRows('staff-1', 'tenant-a', [
      { name: 'new-1' } as any,
      { name: 'new-2' } as any,
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.staff_user_id === 'staff-1' && r.tenant_id === 'tenant-a')).toBe(
      true,
    );

    const rows = getRows();
    // Other tenant's row for the same staff id: untouched.
    expect(rows.find((r) => r.id === 'r2')).toBeTruthy();
    // Other staff member's row in the same tenant: untouched.
    expect(rows.find((r) => r.id === 'r3')).toBeTruthy();
    // The old target-set row is gone, replaced by the new set.
    expect(rows.find((r) => r.id === 'r1')).toBeFalsy();
    expect(
      rows.filter((r) => r.staff_user_id === 'staff-1' && r.tenant_id === 'tenant-a'),
    ).toHaveLength(2);
  });

  it('clears all rows for the target set when given an empty array', async () => {
    const { repo, getRows } = createFakeRepo([
      { id: 'r1', staff_user_id: 'staff-1', tenant_id: 'tenant-a', name: 'old-1' },
      { id: 'r2', staff_user_id: 'staff-1', tenant_id: 'tenant-a', name: 'old-2' },
    ]);
    const service = new TestRowService(repo);

    const result = await service.replaceRows('staff-1', 'tenant-a', []);

    expect(result).toEqual([]);
    expect(getRows()).toHaveLength(0);
  });

  it('runs delete and insert inside one transaction', async () => {
    const { repo } = createFakeRepo([]);
    const service = new TestRowService(repo);

    await service.replaceRows('staff-1', 'tenant-a', [{ name: 'a' } as any]);

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('runs afterWrite inside the transaction, passed the transaction manager', async () => {
    const { repo } = createFakeRepo([]);
    const service = new TestRowService(repo);
    const afterWrite = vi.fn(async () => {});

    await service.replaceRows('staff-1', 'tenant-a', [{ name: 'a' } as any], afterWrite);

    expect(afterWrite).toHaveBeenCalledOnce();
    expect(afterWrite).toHaveBeenCalledWith(expect.objectContaining({ getRepository: expect.any(Function) }));
  });

  it('runs afterWrite even when clearing all rows (empty array)', async () => {
    const { repo } = createFakeRepo([
      { id: 'r1', staff_user_id: 'staff-1', tenant_id: 'tenant-a', name: 'old-1' },
    ]);
    const service = new TestRowService(repo);
    const afterWrite = vi.fn(async () => {});

    await service.replaceRows('staff-1', 'tenant-a', [], afterWrite);

    expect(afterWrite).toHaveBeenCalledOnce();
  });
});
