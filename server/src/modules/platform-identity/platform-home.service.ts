import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { School } from '../schools/entities/school.entity';
import { TenantStatusService } from '../schools/tenant-status.service';

export const PLATFORM_HOME_SLUG = 'biddaloy-platform';

/** [Epic 98] The platform's own school row (`schools.is_platform`). At most one exists. */
@Injectable()
export class PlatformHomeService {
  private cachedId: string | undefined;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  /** The flagged school's id, or undefined. A miss is not cached. */
  async id(): Promise<string | undefined> {
    if (this.cachedId) return this.cachedId;
    const row = await this.ds.getRepository(School).findOne({
      where: { is_platform: true },
      select: { id: true },
    });
    if (row) this.cachedId = row.id;
    return row?.id;
  }

  /**
   * Make sure a flagged row exists and return its id (D3b): reuse the flagged row; else flag the
   * old platform school when it has no students; else insert `biddaloy-platform`. A school that
   * has students is never touched.
   */
  async ensure(manager?: EntityManager): Promise<string> {
    const em = manager ?? this.ds.manager;
    const flagged = await em.findOne(School, {
      where: { is_platform: true },
      select: { id: true },
    });
    if (flagged) return (this.cachedId = flagged.id);

    const oldId = await this.tenantStatus.platformTenantId();
    if (oldId) {
      const old = await em.findOne(School, { where: { id: oldId }, select: { id: true } });
      if (old) {
        const students = await em.query(`SELECT 1 FROM students WHERE tenant_id = $1 LIMIT 1`, [
          old.id,
        ]);
        if (students.length === 0) {
          await em.update(School, { id: old.id }, { is_platform: true });
          return (this.cachedId = old.id);
        }
      }
    }

    // ponytail: a concurrent insert would lose to UQ_schools_one_platform; OwnerSeedingService
    // serialises boots with an advisory lock, so the race does not arise there.
    const created = await em.save(
      em.create(School, { slug: PLATFORM_HOME_SLUG, name: 'Biddaloy Platform', is_platform: true }),
    );
    return (this.cachedId = created.id);
  }
}
