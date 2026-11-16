import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityTarget, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { AdmissionApplicantStatus, AdmissionStageKind } from '@biddaloy/shared';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageResult } from './entities/admission-stage-result.entity';
import { AdmissionList } from './entities/admission-list.entity';
import { AdmissionListMember } from './entities/admission-list-member.entity';
import { buildExportWorkbook, type ExportCell } from './admission-reports-export.util';
import { StudentLifecycleEvent } from '../students/entities/student-lifecycle-event.entity';
import {
  AdmissionExportKind,
  FunnelReportDto,
  FunnelReportQueryDto,
  FunnelStepDto,
  LifecycleReportDto,
  LifecycleReportQueryDto,
  LifecycleReportRowDto,
} from './dto/admission-reports.dto';

const ROW_CAP = 500;
/** Offered, fee pending and admitted applicants are past every stage (a CLERK admit has no stage rows). */
const ADVANCED: string[] = [
  AdmissionApplicantStatus.OFFERED,
  AdmissionApplicantStatus.FEE_PENDING,
  AdmissionApplicantStatus.ADMITTED,
];

type Scope = Pick<LifecycleReportQueryDto, 'academic_year_id' | 'class_id'>;

/** Applicant -> intake -> section -> class, in one tenant and year; `a` must be the applicants alias. */
function scoped<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  tenantId: string,
  q: Scope,
): SelectQueryBuilder<T> {
  qb.innerJoin('admission_intakes', 'i', 'i.id = a.intake_id AND i.tenant_id = a.tenant_id')
    .innerJoin('class_sections', 's', 's.id = i.class_section_id AND s.tenant_id = a.tenant_id')
    .innerJoin('classes', 'c', 'c.id = s.class_id AND c.tenant_id = a.tenant_id')
    .where('a.tenant_id = :tenantId AND a.deleted_at IS NULL AND c.academic_year_id = :yr', {
      tenantId,
      yr: q.academic_year_id,
    });
  if (q.class_id) qb.andWhere('c.id = :cid', { cid: q.class_id });
  return qb;
}

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

  private qb<T extends ObjectLiteral>(entity: EntityTarget<T>, alias: string) {
    return this.applicants.manager.createQueryBuilder(entity, alias);
  }

  /**
   * [Epic 71 D18] Funnel, ONLINE/CLERK split and quota counts. Everything counts by status, never
   * by source (bug #2881: admitted was once counted for ONLINE only). An applicant's depth is how
   * many leading stages of their round they passed; ADVANCED statuses count at every step, so each
   * step is at most the previous one.
   * ponytail: whole year in memory (a school has hundreds to a few thousand applicants); SQL
   * aggregation if one tenant ever passes ~50k.
   */
  async funnel(tenantId: string, q: FunnelReportQueryDto): Promise<FunnelReportDto> {
    const apps = await scoped(this.qb(AdmissionApplicant, 'a'), tenantId, q)
      .select(['a.id', 'a.status', 'a.source', 'a.quota_tags', 'a.intake_id'])
      .getMany();
    const intakeIds = [...new Set(apps.map((a) => a.intake_id))];
    const [stages, results] = intakeIds.length
      ? await Promise.all([
          this.qb(AdmissionStage, 'st')
            .where('st.tenant_id = :tenantId AND st.deleted_at IS NULL', { tenantId })
            .andWhere('st.kind != :none AND st.intake_id IN (:...intakeIds)', {
              none: AdmissionStageKind.NONE,
              intakeIds,
            })
            .orderBy('st.position', 'ASC')
            .getMany(),
          scoped(
            this.qb(AdmissionStageResult, 'r').innerJoin(
              'admission_applicants',
              'a',
              'a.id = r.applicant_id AND a.tenant_id = r.tenant_id',
            ),
            tenantId,
            q,
          )
            .andWhere('r.deleted_at IS NULL AND r.passed = true')
            .getMany(),
        ])
      : [[], []];

    const passed = new Set(results.map((r) => `${r.applicant_id}:${r.stage_id}`));
    const stagesByIntake = new Map<string, AdmissionStage[]>();
    for (const st of stages) {
      stagesByIntake.set(st.intake_id, [...(stagesByIntake.get(st.intake_id) ?? []), st]);
    }
    const steps = Math.max(0, ...[...stagesByIntake.values()].map((l) => l.length));
    const kindsAt = (k: number) =>
      [...new Set([...stagesByIntake.values()].map((l) => l[k]?.kind).filter(Boolean))].join('/');

    const depthOf = (a: AdmissionApplicant) => {
      if (ADVANCED.includes(a.status)) return Infinity;
      const list = stagesByIntake.get(a.intake_id) ?? [];
      let d = 0;
      while (d < list.length && passed.has(`${a.id}:${list[d].id}`)) d += 1;
      return d;
    };
    const depths = apps.map(depthOf);

    const funnel: FunnelStepDto[] = [
      { step: 'APPLIED', position: null, kind: null, count: apps.length },
      ...Array.from({ length: steps }, (_, k) => ({
        step: 'STAGE',
        position: k + 1,
        kind: kindsAt(k),
        count: depths.filter((d) => d >= k + 1).length,
      })),
      {
        step: 'OFFERED',
        position: null,
        kind: null,
        count: apps.filter((a) => ADVANCED.includes(a.status)).length,
      },
      {
        step: 'ADMITTED',
        position: null,
        kind: null,
        count: apps.filter((a) => a.status === AdmissionApplicantStatus.ADMITTED).length,
      },
    ];

    const admitted = (a: AdmissionApplicant) => a.status === AdmissionApplicantStatus.ADMITTED;
    const sources = ['ONLINE', 'CLERK'].map((source) => {
      const of = apps.filter((a) => a.source === source);
      return { source, applied: of.length, admitted: of.filter(admitted).length };
    });
    const byQuota = new Map<string, { applied: number; admitted: number }>();
    for (const a of apps) {
      for (const tag of new Set(a.quota_tags ?? [])) {
        const row = byQuota.get(tag) ?? { applied: 0, admitted: 0 };
        row.applied += 1;
        if (admitted(a)) row.admitted += 1;
        byQuota.set(tag, row);
      }
    }
    const quotas = [...byQuota.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([quota, v]) => ({ quota, ...v }));
    return { funnel, sources, quotas };
  }

  /**
   * [Epic 71 D18] One `.xlsx` of the applicants, stage scores or merit/waiting lists.
   * ponytail: no row cap (one year of one school, thousands at most); stream rows if that stops holding.
   * Applicants whose intake has no class section are left out, same as the lifecycle report.
   */
  async exportKind(tenantId: string, kind: AdmissionExportKind, q: Scope): Promise<Buffer> {
    const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
    if (kind === 'applicants') {
      const rows = await scoped(this.qb(AdmissionApplicant, 'a'), tenantId, q)
        .select('a.reference_number', 'ref')
        .addSelect('a.applicant_name', 'name')
        .addSelect('c.name', 'class_name')
        .addSelect('a.source', 'source')
        .addSelect('a.status', 'status')
        .addSelect('a.quota_tags', 'quotas')
        .addSelect('a.fee_state', 'fee_state')
        .addSelect('a.merit_rank', 'merit_rank')
        .addSelect('a.roll_number', 'roll')
        .addSelect("to_char(a.created_at, 'YYYY-MM-DD')", 'applied_on')
        .orderBy('a.created_at', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .getRawMany();
      return buildExportWorkbook(
        'applicants',
        [
          'Reference',
          'Name',
          'Class',
          'Source',
          'Status',
          'Quotas',
          'Fee',
          'Merit rank',
          'Roll',
          'Applied on',
        ],
        rows.map((r): ExportCell[] => [
          r.ref,
          r.name,
          r.class_name,
          r.source,
          r.status,
          ((r.quotas as string[]) ?? []).join(', '),
          r.fee_state,
          num(r.merit_rank),
          r.roll,
          r.applied_on,
        ]),
      );
    }
    if (kind === 'scores') {
      const rows = await scoped(
        this.qb(AdmissionStageResult, 'r')
          .innerJoin('admission_stages', 'st', 'st.id = r.stage_id AND st.tenant_id = r.tenant_id')
          .innerJoin(
            'admission_applicants',
            'a',
            'a.id = r.applicant_id AND a.tenant_id = r.tenant_id',
          ),
        tenantId,
        q,
      )
        .andWhere('r.deleted_at IS NULL AND st.deleted_at IS NULL')
        .select('a.reference_number', 'ref')
        .addSelect('a.applicant_name', 'name')
        .addSelect('st.position', 'position')
        .addSelect('st.kind', 'kind')
        .addSelect('st.title', 'title')
        .addSelect('r.score', 'score')
        .addSelect('r.passed', 'passed')
        .orderBy('a.reference_number', 'ASC')
        .addOrderBy('st.position', 'ASC')
        .getRawMany();
      return buildExportWorkbook(
        'scores',
        ['Reference', 'Name', 'Stage', 'Kind', 'Title', 'Score', 'Passed'],
        rows.map((r): ExportCell[] => [
          r.ref,
          r.name,
          num(r.position),
          r.kind,
          r.title,
          num(r.score),
          r.passed === null ? null : r.passed ? 'YES' : 'NO',
        ]),
      );
    }
    const rows = await scoped(
      this.qb(AdmissionListMember, 'm')
        .innerJoin(AdmissionList, 'l', 'l.id = m.list_id AND l.tenant_id = m.tenant_id')
        .innerJoin(
          'admission_applicants',
          'a',
          'a.id = m.applicant_id AND a.tenant_id = m.tenant_id',
        ),
      tenantId,
      q,
    )
      .andWhere('m.deleted_at IS NULL AND l.deleted_at IS NULL')
      .select('i.title', 'round')
      .addSelect('l.kind', 'kind')
      .addSelect('l.sequence', 'sequence')
      .addSelect('m.position', 'position')
      .addSelect('a.reference_number', 'ref')
      .addSelect('a.applicant_name', 'name')
      .addSelect('a.status', 'status')
      // Sequence numbers repeat across rounds: group by round (id breaks title ties) first.
      .orderBy('i.title', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .addOrderBy('l.kind', 'ASC')
      .addOrderBy('l.sequence', 'ASC')
      .addOrderBy('m.position', 'ASC')
      .getRawMany();
    return buildExportWorkbook(
      'lists',
      ['Round', 'List', 'Sequence', 'Position', 'Reference', 'Name', 'Status'],
      rows.map((r): ExportCell[] => [
        r.round,
        r.kind,
        num(r.sequence),
        num(r.position),
        r.ref,
        r.name,
        r.status,
      ]),
    );
  }
}
