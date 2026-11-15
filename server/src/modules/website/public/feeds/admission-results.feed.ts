import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Feed, FeedRow } from './feed-registry';

/**
 * The result-lookup widget (Epic 71 D8): one descriptor row when any stage or list of a round is
 * published, none otherwise. It carries no applicant data; the lookup itself is the public API.
 */
@Injectable()
export class AdmissionResultsFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    return this.ds.query(
      `SELECT i.id AS round_id, i.title
         FROM admission_intakes i
        WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
          AND (EXISTS (SELECT 1 FROM admission_stages s
                        WHERE s.tenant_id = i.tenant_id AND s.intake_id = i.id
                          AND s.deleted_at IS NULL AND s.config ? 'published_at')
            OR EXISTS (SELECT 1 FROM admission_lists l
                        WHERE l.tenant_id = i.tenant_id AND l.intake_id = i.id
                          AND l.deleted_at IS NULL AND l.published_at IS NOT NULL))
        ORDER BY i.close_date DESC, i.id
        LIMIT 1`,
      [tenantId],
    );
  }
}
