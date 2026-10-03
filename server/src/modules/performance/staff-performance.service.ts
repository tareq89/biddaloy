import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { STAFF_ROLES } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcrAssessmentsService } from '../acr/acr-assessments.service';
import { SurveyResultsService } from '../surveys/survey-results.service';
import { IncidentsService } from '../incidents/incidents.service';
import { PerformanceService, Range } from './performance.service';
import {
  ClassPerformanceResponseDto,
  PerformanceQueryDto,
  StaffPerformanceResponseDto,
} from './dto/performance.dto';

const CLASS_OUTCOME_CONCURRENCY = 4;

/** Runs fn over items with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * [28.3.6] Staff performance. The controller gates the caller to ACR_READ.
 * Privacy (D2/D13): the subject 404s on their own record before any other
 * service is touched; survey data comes only from SurveyResultsService (sealed).
 */
@Injectable()
export class StaffPerformanceService {
  constructor(
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    private readonly acr: AcrAssessmentsService,
    private readonly surveys: SurveyResultsService,
    private readonly incidents: IncidentsService,
    private readonly performance: PerformanceService,
  ) {}

  async get(
    userId: string,
    q: PerformanceQueryDto,
    tenantId: string,
    callerId: string,
  ): Promise<StaffPerformanceResponseDto> {
    // D2: first, before ACR/incidents (which would silently filter).
    if (userId === callerId) throw new NotFoundException('Staff member not found');
    const member = await this.memberships.findOne({
      where: { user_id: userId, tenant_id: tenantId, role: In(STAFF_ROLES as unknown as string[]) },
    });
    if (!member) throw new NotFoundException('Staff member not found');
    const range = await this.performance.resolveRange(tenantId, q.academicYearId, q.termId);

    const [history, survey, incidents, classes] = await Promise.all([
      this.acr.history(userId, tenantId, callerId),
      this.surveys.teacherAverage(userId, tenantId),
      this.incidents.list({ staffUserId: userId }, tenantId, callerId),
      this.classOutcomes(userId, tenantId, range),
    ]);

    return {
      userId,
      acr: history.map((a) => ({
        academicYearId: a.academic_year_id,
        status: a.status,
        total: a.total,
      })),
      survey,
      incidentCount: incidents.length,
      classes,
    };
  }

  /** One entry per distinct section the teacher is assigned to; non-teachers get []. */
  private async classOutcomes(
    userId: string,
    tenantId: string,
    range: Range,
  ): Promise<ClassPerformanceResponseDto[]> {
    const teachers = await this.teacherRepo.find({
      where: { user_id: userId, tenant_id: tenantId },
      select: { id: true },
      // A former (soft-deleted) teacher's historical classes stay visible to ACR_READ admins.
      withDeleted: true,
    });
    if (!teachers.length) return [];
    const rows = await this.tcsRepo.find({
      where: { tenant_id: tenantId, teacher_id: In(teachers.map((t) => t.id)) },
      select: { section_id: true },
    });
    const sectionIds = [...new Set(rows.map((r) => r.section_id))];
    if (!sectionIds.length) return [];
    const sections = await this.sectionRepo.find({
      // Only classes of the requested academic year, else old-year sections show as stale entries.
      where: {
        tenant_id: tenantId,
        id: In(sectionIds),
        class: { tenant_id: tenantId, academic_year_id: range.academicYearId },
      },
    });
    return mapLimit(sections, CLASS_OUTCOME_CONCURRENCY, (s) =>
      this.performance.computeClassOutcomes(tenantId, s.class_id, s.id, range),
    );
  }
}
