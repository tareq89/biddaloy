import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { School } from '../schools/entities/school.entity';

export const PLATFORM_HOME_SLUG = 'biddaloy-platform';

/** [Epic 98] The platform's own school row (`schools.is_platform`). At most one exists. */
@Injectable()
export class PlatformHomeService {
  private cachedId: string | undefined;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

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
   * Make sure a flagged row exists and return its id (D3b): reuse the flagged row, else insert
   * `biddaloy-platform`. An existing school is never touched.
   */
  async ensure(manager?: EntityManager): Promise<string> {
    const em = manager ?? this.ds.manager;
    const flagged = await em.findOne(School, {
      where: { is_platform: true },
      select: { id: true },
    });
    if (flagged) return (this.cachedId = flagged.id);

    // ponytail: a concurrent insert would lose to UQ_schools_one_platform; OwnerSeedingService
    // serialises boots with an advisory lock, so the race does not arise there.
    // Wave 2: before any caller uses ensure() outside OwnerSeedingService it needs a
    // retry-on-unique-violation (UQ_schools_one_platform): catch it and re-read the home.
    const created = await em.save(
      em.create(School, { slug: PLATFORM_HOME_SLUG, name: 'Biddaloy Platform', is_platform: true }),
    );
    return (this.cachedId = created.id);
  }
}
