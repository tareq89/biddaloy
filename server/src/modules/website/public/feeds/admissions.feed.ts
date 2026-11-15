import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolsService } from '../../../schools/schools.service';
import type { Feed, FeedRow } from './feed-registry';

/**
 * Admission rounds for the site's Apply widget (Epic 71 D7, D8). No link is printed: the themes
 * build `/<lang>/admission?round=<round_id>` (a relative `/admission/<slug>` was #3721).
 * A round shows while it is open today (the school's date); one with `widget_always_show` stays
 * after it closes, with `open: false`.
 */
@Injectable()
export class AdmissionsFeed implements Feed {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const today = await this.schools.todayFor(tenantId);
    const rows: {
      round_id: string;
      title: string;
      deadline: string;
      seats_left: number;
      always_show: boolean;
      open: boolean;
    }[] = await this.ds.query(
      `SELECT i.id AS round_id, i.title, to_char(i.close_date, 'YYYY-MM-DD') AS deadline,
              GREATEST(i.seat_count - (
                SELECT count(*)::int FROM admission_applicants a
                 WHERE a.tenant_id = i.tenant_id AND a.intake_id = i.id AND a.deleted_at IS NULL
                   AND a.status = 'ADMITTED'), 0) AS seats_left,
              i.widget_always_show AS always_show,
              (i.open_date <= $2::date AND i.close_date >= $2::date) AS open
         FROM admission_intakes i
        WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
          AND ((i.open_date <= $2::date AND i.close_date >= $2::date) OR i.widget_always_show)
        ORDER BY open DESC, i.close_date, i.id
        LIMIT 20`,
      [tenantId, today],
    );
    return rows;
  }
}
