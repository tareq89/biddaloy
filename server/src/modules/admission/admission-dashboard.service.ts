import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AdmissionApplicantStatus, DashboardWidgetKey } from '@biddaloy/shared';
import { endOfLocalDay, startOfLocalDay } from '../../common/time';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SchoolsService } from '../schools/schools.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import type { AdmissionsTodayDto } from './dto/admission-dashboard.dto';

/** "Admission applications today" dashboard widget (OFFICE_STAFF, ADMIN). */
@Injectable()
export class AdmissionDashboardService {
  constructor(
    @InjectRepository(AdmissionApplicant)
    private readonly applicants: Repository<AdmissionApplicant>,
    private readonly schools: SchoolsService,
    private readonly cache: DashboardCacheService,
  ) {}

  getAdmissionsToday(tenantId: string): Promise<AdmissionsTodayDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.ADMISSIONS_TODAY,
      'school',
      async () => {
        const today = await this.schools.todayFor(tenantId);
        const [counts, latest] = await Promise.all([
          this.applicants
            .createQueryBuilder('a')
            .select('COUNT(*) FILTER (WHERE a.created_at BETWEEN :from AND :to)', 'new_today')
            .addSelect('COUNT(*) FILTER (WHERE a.status = :pending)', 'pending_total')
            .where('a.tenant_id = :tenantId AND a.deleted_at IS NULL', { tenantId })
            .setParameters({
              from: startOfLocalDay(today),
              to: endOfLocalDay(today),
              pending: AdmissionApplicantStatus.PENDING,
            })
            .getRawOne<{ new_today: string; pending_total: string }>(),
          // Same `where` as ApplicantReviewService.list, capped at 5.
          this.applicants.find({
            where: { tenant_id: tenantId, deleted_at: IsNull() },
            order: { created_at: 'DESC' },
            take: 5,
          }),
        ]);
        return {
          new_today: Number(counts?.new_today ?? 0),
          pending_total: Number(counts?.pending_total ?? 0),
          latest: latest.map((a) => ({
            id: a.id,
            reference_number: a.reference_number,
            applicant_name: a.applicant_name,
            created_at: a.created_at.toISOString(),
            status: a.status,
          })),
        };
      },
    );
  }
}
