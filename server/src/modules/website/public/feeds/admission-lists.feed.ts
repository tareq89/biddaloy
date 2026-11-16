import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Feed, FeedRow } from './feed-registry';

/** Cap on published lists and on listed members per list, so one school cannot grow the page. */
const MAX_LISTS = 10;
const MAX_MEMBERS = 500;

/**
 * Published admission lists (Epic 71 D8). A member is the roll number only; the name is added
 * only when the round has `show_names_publicly`. A member with no roll number is left out.
 */
@Injectable()
export class AdmissionListsFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const lists: {
      list_id: string;
      round_id: string;
      round_title: string;
      kind: string;
      sequence: number;
      act_by_date: string | null;
      show_names: boolean;
    }[] = await this.ds.query(
      `SELECT l.id AS list_id, i.id AS round_id, i.title AS round_title, l.kind, l.sequence,
              to_char(l.act_by_date, 'YYYY-MM-DD') AS act_by_date,
              i.show_names_publicly AS show_names
         FROM admission_lists l
         JOIN admission_intakes i ON i.id = l.intake_id AND i.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND i.deleted_at IS NULL
          AND l.published_at IS NOT NULL
        ORDER BY l.published_at DESC, l.id
        LIMIT $2`,
      [tenantId, MAX_LISTS],
    );
    if (lists.length === 0) return [];
    // row_number per list, so one big list never starves another (cap is per list).
    const members: { list_id: string; roll: string; name: string }[] = await this.ds.query(
      `SELECT list_id, roll, name FROM (
         SELECT m.list_id, a.roll_number AS roll, a.applicant_name AS name, m.position,
                row_number() OVER (PARTITION BY m.list_id ORDER BY m.position, m.id) AS rn
           FROM admission_list_members m
           JOIN admission_applicants a ON a.id = m.applicant_id AND a.tenant_id = m.tenant_id
          WHERE m.tenant_id = $1 AND m.list_id = ANY($2::uuid[]) AND m.deleted_at IS NULL
            AND a.deleted_at IS NULL AND a.roll_number IS NOT NULL) x
        WHERE rn <= $3
        ORDER BY list_id, position`,
      [tenantId, lists.map((l) => l.list_id), MAX_MEMBERS],
    );
    return lists.map((l) => ({
      list_id: l.list_id,
      round_id: l.round_id,
      round_title: l.round_title,
      kind: l.kind,
      sequence: l.sequence,
      act_by_date: l.act_by_date,
      members: members
        .filter((m) => m.list_id === l.list_id)
        .map((m) => (l.show_names ? { roll: m.roll, name: m.name } : { roll: m.roll })),
    }));
  }
}
