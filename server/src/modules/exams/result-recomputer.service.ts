import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExamStatus } from '@biddaloy/shared';
import { ResultRecomputer } from '../grading/recompute.service';
import { ResultsService } from './results.service';

interface ExamUsingScale {
  id: string;
  name: string;
  status: ExamStatus;
}

/**
 * [68.2.06] The real `ResultRecomputer` (it replaces the grading module's
 * no-op stub): when a grading scale's bands change, every PROCESSED exam
 * whose results were graded against that scale is recomputed inside the
 * band edit's own transaction. PUBLISHED results are frozen (D16), so a
 * scale used by one is refused instead.
 */
@Injectable()
export class ExamResultRecomputer implements ResultRecomputer {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resultsService: ResultsService,
  ) {}

  /** Exams with a live result graded against the scale (tenant-scoped). */
  private examsUsingScale(
    manager: EntityManager,
    tenantId: string,
    scaleId: string,
  ): Promise<ExamUsingScale[]> {
    return manager.query(
      `SELECT DISTINCT e.id, e.name, e.status
         FROM results r
         JOIN exams e ON e.id = r.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL`,
      [tenantId, scaleId],
    );
  }

  async countAffected(
    tenantId: string,
    scaleId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await manager.query(
      `SELECT COUNT(*)::text AS count
         FROM results r
         JOIN exams e ON e.id = r.exam_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.grading_scale_id = $2 AND r.deleted_at IS NULL
          AND e.status = $3`,
      [tenantId, scaleId, ExamStatus.PROCESSED],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async findPublishedExams(
    tenantId: string,
    scaleId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Array<{ id: string; name: string }>> {
    const exams = await this.examsUsingScale(manager, tenantId, scaleId);
    return exams
      .filter((e) => e.status === ExamStatus.PUBLISHED)
      .map(({ id, name }) => ({ id, name }));
  }

  async recompute(tenantId: string, scaleId: string, manager: EntityManager): Promise<number> {
    const exams = await this.examsUsingScale(manager, tenantId, scaleId);
    const published = exams.filter((e) => e.status === ExamStatus.PUBLISHED);
    if (published.length > 0) {
      // D16: a scale edit is refused while published results use it. The
      // throw rolls back the band change (RecomputeService.confirm, D6).
      throw new ConflictException({
        message: 'Published results use this grading scale. Reopen them first.',
        details: {
          code: 'SCALE_IN_PUBLISHED_RESULTS',
          exams: published.map(({ id, name }) => ({ id, name })),
        },
      });
    }
    let total = 0;
    for (const exam of exams.filter((e) => e.status === ExamStatus.PROCESSED)) {
      total += await this.resultsService.recomputeProcessedExam(manager, exam.id, tenantId, null, {
        ip: null,
        userAgent: null,
      });
    }
    return total;
  }
}
