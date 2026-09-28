import { Repository, ObjectLiteral, DeepPartial, EntityManager } from 'typeorm';

/** Any dynamic-row entity: one row per `(staff_user_id, tenant_id)` set,
 * with no FK to `StaffHrRecord` (23.3 step 2). */
interface RepeatableRow extends ObjectLiteral {
  id: string;
  staff_user_id: string;
  tenant_id: string;
}

/**
 * Generic "list of rows owned by one staff member, replace-on-save" base
 * (D3) for the 7 dynamic-row sections (family, address, experience, ...).
 *
 * `replaceRows` is the only write: one transaction, explicit delete-then-
 * insert for `(staffUserId, tenantId)` — never a bare `repository.save()`
 * on a loaded, tenant-filtered collection, which would NULL other tenants'
 * FKs instead of leaving them alone (the incident this invariant guards
 * against).
 */
export abstract class RepeatableRowBaseService<T extends RepeatableRow> {
  protected constructor(protected readonly repo: Repository<T>) {}

  async findRows(staffUserId: string, tenantId: string): Promise<T[]> {
    return this.repo.find({
      where: { staff_user_id: staffUserId, tenant_id: tenantId } as unknown as T,
    });
  }

  async replaceRows(
    staffUserId: string,
    tenantId: string,
    rows: Array<Omit<DeepPartial<T>, 'id' | 'staff_user_id' | 'tenant_id'>>,
    afterWrite?: (manager: EntityManager) => Promise<void>,
  ): Promise<T[]> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(this.repo.target);
      await repo.delete({ staff_user_id: staffUserId, tenant_id: tenantId } as never);
      const saved =
        rows.length === 0
          ? []
          : await repo.save(
              rows.map((row) =>
                repo.create({
                  ...row,
                  staff_user_id: staffUserId,
                  tenant_id: tenantId,
                } as DeepPartial<T>),
              ),
            );
      await afterWrite?.(manager);
      return saved;
    });
  }
}
