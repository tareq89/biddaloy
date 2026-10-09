import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { StudentLifecycleEvent } from '../students/entities/student-lifecycle-event.entity';
import {
  LifecycleReportDto,
  LifecycleReportQueryDto,
  LifecycleReportRowDto,
} from './dto/admission-reports.dto';

const ROW_CAP = 500;

/**
 * [39.5.1] Admitted / left / graduated / readmitted counts + rows for one
 * academic year. `admitted` comes from applicants (D5): ADMITTED is terminal,
 * so `updated_at` is the admit time; the year is intake -> section -> class.
 */
@Injectable()
export class AdmissionReportsService {
  constructor(
    @InjectRepository(AdmissionApplicant)
    private readonly applicants: Repository<AdmissionApplicant>,
    @InjectRepository(StudentLifecycleEvent)
    private readonly events: Repository<StudentLifecycleEvent>,
  ) {}

  async lifecycle(tenantId: string, q: LifecycleReportQueryDto): Promise<LifecycleReportDto> {
    const admittedQb = this.applicants
      .createQueryBuilder('a')
      .innerJoin('admission_intakes', 'i', 'i.id = a.intake_id AND i.tenant_id = a.tenant_id')
      .innerJoin('class_sections', 's', 's.id = i.class_section_id AND s.tenant_id = a.tenant_id')
      .innerJoin('classes', 'c', 'c.id = s.class_id AND c.tenant_id = a.tenant_id')
      .where('a.tenant_id = :tenantId AND a.status = :st AND c.academic_year_id = :yr', {
        tenantId,
        st: AdmissionApplicantStatus.ADMITTED,
        yr: q.academic_year_id,
      });
    if (q.class_id) admittedQb.andWhere('c.id = :cid', { cid: q.class_id });

    const eventQb = this.events
      .createQueryBuilder('e')
      .innerJoin('students', 'st', 'st.id = e.student_id AND st.tenant_id = e.tenant_id')
      .innerJoin('enrollments', 'en', 'en.id = e.enrollment_id AND en.tenant_id = e.tenant_id')
      .innerJoin('classes', 'c', 'c.id = en.class_id AND c.tenant_id = e.tenant_id')
      .where('e.tenant_id = :tenantId AND e.academic_year_id = :yr', {
        tenantId,
        yr: q.academic_year_id,
      });
    if (q.class_id) eventQb.andWhere('en.class_id = :cid', { cid: q.class_id });

    const [admittedCount, eventCounts, admittedRows, eventRows] = await Promise.all([
      admittedQb.clone().getCount(),
      eventQb
        .clone()
        .select('e.event_type', 'type')
        .addSelect('COUNT(*)::int', 'n')
        .groupBy('e.event_type')
        .getRawMany<{ type: string; n: number }>(),
      admittedQb
        .clone()
        .select('a.applicant_name', 'name')
        .addSelect("to_char(a.updated_at, 'YYYY-MM-DD')", 'occurred_on')
        .addSelect('c.name', 'class_name')
        .orderBy('a.updated_at', 'DESC')
        .limit(ROW_CAP + 1)
        .getRawMany<{ name: string; occurred_on: string; class_name: string }>(),
      eventQb
        .clone()
        .select('e.student_id', 'student_id')
        .addSelect('st.full_name', 'name')
        .addSelect('st.registration_number', 'registration_number')
        .addSelect('c.name', 'class_name')
        .addSelect('e.event_type', 'event_type')
        .addSelect("to_char(e.occurred_on, 'YYYY-MM-DD')", 'occurred_on')
        .addSelect('e.reason', 'reason')
        .addSelect('e.destination', 'destination')
        .orderBy('e.occurred_on', 'DESC')
        .limit(ROW_CAP + 1)
        .getRawMany<LifecycleReportRowDto>(),
    ]);

    const n = (t: string) => eventCounts.find((r) => r.type === t)?.n ?? 0;
    const all: LifecycleReportRowDto[] = [
      ...admittedRows.map((r) => ({
        student_id: null,
        name: r.name,
        registration_number: null,
        class_name: r.class_name,
        event_type: 'ADMITTED',
        occurred_on: r.occurred_on,
        reason: null,
        destination: null,
      })),
      ...eventRows,
    ].sort((x, y) => (x.occurred_on < y.occurred_on ? 1 : x.occurred_on > y.occurred_on ? -1 : 0));

    return {
      counts: {
        admitted: admittedCount,
        withdrawn: n('WITHDRAWN'),
        transferred_out: n('TRANSFERRED_OUT'),
        graduated: n('GRADUATED'),
        readmitted: n('READMITTED'),
      },
      rows: all.slice(0, ROW_CAP),
      truncated: all.length > ROW_CAP,
    };
  }
}
