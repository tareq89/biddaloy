import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction, ApprovalScope, FeeStatus, FeeType } from '@biddaloy/shared';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { School } from '../../schools/entities/school.entity';
import { resolveTenantSettings } from '../../schools/settings/tenant-settings-resolver';
import { todayInSchoolTz } from '../../../common/time';
import { FeeGenerationService } from '../fee-generation.service';
import { ApprovalService } from '../../auth/guards/approval.guard';
import { AuditService } from '../../audit/audit.service';
import { FeeGenerationSource, PeriodType } from '@biddaloy/shared';
import {
  LogFineDto,
  LogFineResultDto,
  WaiveFineDto,
  WaiveFineResultDto,
  QueryFinesDto,
  FinesListResultDto,
  StaffFineDto,
  FineOrigin,
} from './dto/fines.dto';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  currentTenant?: { id: string };
  user?: { sub: string };
}

const EPSILON = 0.01;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class FinesService {
  constructor(
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly feeGenerationService: FeeGenerationService,
    private readonly approvalService: ApprovalService,
    private readonly auditService: AuditService,
  ) {}

  async logFine(
    dto: LogFineDto,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<LogFineResultDto> {
    const structure = await this.feeStructureRepo.findOne({
      where: { id: dto.fee_structure_id, tenant_id: tenantId },
    });
    if (!structure) {
      throw new NotFoundException(`Fee structure "${dto.fee_structure_id}" not found`);
    }
    if (structure.fee_type !== FeeType.FINE) {
      throw new BadRequestException('fee_structure_id must reference a FINE fee structure');
    }

    const incidentDate = new Date(`${dto.incident_date}T00:00:00.000Z`);
    if (Number.isNaN(incidentDate.getTime())) {
      throw new BadRequestException(`Invalid incident_date "${dto.incident_date}"`);
    }
    const todayKey = todayInSchoolTz();
    if (dto.incident_date > todayKey) {
      throw new BadRequestException('incident_date must not be in the future');
    }

    const academicYear = await this.academicYearRepo.findOne({
      where: { id: structure.academic_year_id, tenant_id: tenantId },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year "${structure.academic_year_id}" not found`);
    }
    const start = new Date(academicYear.start_date);
    const end = new Date(academicYear.end_date);
    if (incidentDate < start || incidentDate > end) {
      throw new BadRequestException(
        `incident_date "${dto.incident_date}" is outside academic year "${academicYear.name}"`,
      );
    }

    const periodStart = `${dto.incident_date.slice(0, 7)}-01`;

    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    const settings = resolveTenantSettings(
      (school?.settings as Record<string, unknown> | null) ?? null,
    );
    const fineDueDays = settings.fees?.fineDueDays ?? 7;
    const dueDate = new Date(`${todayKey}T00:00:00.000Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + fineDueDays);
    const dueDateKey = dueDate.toISOString().slice(0, 10);

    const billOverrides = new Map<
      string,
      { amount: number; note?: string | null; incident_date?: string | null }
    >();
    for (const studentId of dto.student_ids) {
      billOverrides.set(`${studentId}:${structure.id}`, {
        amount: dto.amount ?? Number(structure.amount),
        note: dto.note,
        incident_date: dto.incident_date,
      });
    }

    const result = await this.feeGenerationService.generate(
      {
        academic_year_id: structure.academic_year_id,
        period_start: periodStart,
        period_type: PeriodType.MONTH,
        student_ids: dto.student_ids,
        fee_structure_ids: [structure.id],
        due_date: dueDateKey,
        notify_families: dto.notify_families ?? true,
      },
      tenantId,
      userId,
      request,
      {
        source: FeeGenerationSource.MANUAL,
        billOverrides,
        alwaysNewOccurrence: true,
      },
    );

    const createdBills = await this.studentFeeRepo.find({
      where: { fee_generation_id: result.fee_generation_id },
    });

    return { bill_ids: createdBills.map((b) => b.id) };
  }

  async waiveFine(
    id: string,
    dto: WaiveFineDto,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<WaiveFineResultDto> {
    return this.studentFeeRepo.manager.transaction(async (manager) => {
      const bill = await manager
        .getRepository(StudentFee)
        .createQueryBuilder('sf')
        .innerJoinAndSelect('sf.fee_structure', 'fs')
        .where('sf.id = :id', { id })
        .andWhere('fs.tenant_id = :tenantId', { tenantId })
        .setLock('pessimistic_write', undefined, ['sf'])
        .getOne();
      if (!bill) {
        throw new NotFoundException(`Fine bill "${id}" not found`);
      }
      if (bill.fee_structure.fee_type !== FeeType.FINE) {
        throw new BadRequestException(`Bill "${id}" is not a FINE bill`);
      }

      const outstanding = round2(
        Number(bill.total_amount) - Number(bill.discount_amount) - Number(bill.paid_amount),
      );
      if (outstanding <= 0) {
        throw new ConflictException(`Fine bill "${id}" has no outstanding balance to waive`);
      }

      const requested = dto.amount ?? outstanding;
      if (requested > outstanding + EPSILON) {
        throw new BadRequestException('amount exceeds the bill outstanding balance');
      }
      const amount = Math.min(round2(requested), outstanding);

      // Every validation that can still fail has run — burn the approval
      // token last, same ordering `checkout.service.ts` uses for a one-off
      // discount.
      const approval = await this.approvalService.consume(request, ApprovalScope.FEES_DISCOUNT);

      const newOneOffDiscount = round2(Number(bill.one_off_discount_amount) + amount);
      const newDiscount = round2(Number(bill.discount_amount) + amount);
      const newOutstanding = round2(
        Number(bill.total_amount) - newDiscount - Number(bill.paid_amount),
      );

      let newStatus = bill.status;
      if (newOutstanding <= 0) {
        newStatus = Number(bill.paid_amount) > 0 ? FeeStatus.PAID : FeeStatus.WAIVED;
      }

      await manager
        .getRepository(StudentFee)
        .update(
          { id },
          {
            one_off_discount_amount: newOneOffDiscount,
            discount_amount: newDiscount,
            status: newStatus,
          },
        );

      // [Epic 38 D24] `AuditAction` has no dedicated FINE_WAIVED member.
      // `audit_logs.action` is a Postgres enum column, so adding one needs
      // a shared enum change *and* an `ALTER TYPE` migration — both out of
      // scope here. `UPDATE` on entity_type 'StudentFee' matches the
      // pattern `FeeGenerationService`'s own approval audit uses; the
      // waive reason still lands in `new_values`.
      await this.auditService.recordApproved(
        {
          action: AuditAction.UPDATE,
          entity_type: 'StudentFee',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          approved_by_user_id: approval.approverId,
          approval_scope: ApprovalScope.FEES_DISCOUNT,
          new_values: { reason: dto.reason, amount, status: newStatus },
        },
        manager,
      );

      return { id, amount, status: newStatus };
    });
  }

  async listFines(
    query: QueryFinesDto,
    tenantId: string,
    restrictToStudentIds?: string[],
  ): Promise<FinesListResultDto> {
    if (restrictToStudentIds !== undefined && restrictToStudentIds.length === 0) {
      return {
        items: [],
        total: 0,
        totals: { charged: 0, collected: 0, waived: 0, outstanding: 0 },
      };
    }

    const page = query.page || 1;
    const limit = query.limit || 10;

    const buildBaseQuery = (withFeeStructure = false) => {
      const qb = this.studentFeeRepo.createQueryBuilder('sf');
      if (withFeeStructure) {
        qb.innerJoinAndSelect('sf.fee_structure', 'fs');
      } else {
        qb.innerJoin('sf.fee_structure', 'fs');
      }
      qb.innerJoin('sf.student', 'student')
        .where('fs.tenant_id = :tenantId', { tenantId })
        .andWhere('fs.fee_type = :fineType', { fineType: FeeType.FINE });

      if (query.academic_year_id) {
        qb.andWhere('sf.academic_year_id = :academicYearId', {
          academicYearId: query.academic_year_id,
        });
      }
      if (query.month) {
        qb.andWhere('sf.month = :month', { month: query.month });
      }
      if (query.class_id) {
        qb.innerJoin('student.class_section', 'cs').innerJoin('cs.class', 'cls');
        qb.andWhere('cls.id = :classId', { classId: query.class_id });
      }
      if (query.section_id) {
        if (!query.class_id) {
          qb.innerJoin('student.class_section', 'cs');
        }
        qb.andWhere('cs.id = :sectionId', { sectionId: query.section_id });
      }
      if (query.student_id) {
        qb.andWhere('sf.student_id = :studentId', { studentId: query.student_id });
      }
      if (query.fee_structure_id) {
        qb.andWhere('sf.fee_structure_id = :feeStructureId', {
          feeStructureId: query.fee_structure_id,
        });
      }
      if (query.origin === FineOrigin.RULE) {
        qb.andWhere('sf.fine_rule_id IS NOT NULL');
      } else if (query.origin === FineOrigin.MANUAL) {
        qb.andWhere('sf.fine_rule_id IS NULL');
      }
      if (query.status) {
        qb.andWhere('sf.status = :status', { status: query.status });
      }
      if (restrictToStudentIds !== undefined) {
        qb.andWhere('sf.student_id IN (:...restrictToStudentIds)', { restrictToStudentIds });
      }
      return qb;
    };

    const totalsRow = await buildBaseQuery()
      .select('COALESCE(SUM(sf.total_amount), 0)', 'charged')
      .addSelect('COALESCE(SUM(sf.paid_amount), 0)', 'collected')
      .addSelect('COALESCE(SUM(sf.one_off_discount_amount), 0)', 'waived')
      .addSelect(
        'COALESCE(SUM(sf.total_amount - sf.discount_amount - sf.paid_amount), 0)',
        'outstanding',
      )
      .getRawOne<{ charged: string; collected: string; waived: string; outstanding: string }>();

    const total = await buildBaseQuery().getCount();

    const bills = await buildBaseQuery(true)
      .orderBy('sf.incident_date', 'DESC', 'NULLS LAST')
      .addOrderBy('sf.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    const items: StaffFineDto[] = bills.map((bill) => ({
      id: bill.id,
      student_id: bill.student_id,
      fee_structure_id: bill.fee_structure_id,
      fee_name: bill.fee_structure.name,
      note: bill.note,
      incident_date: bill.incident_date,
      period_start: bill.period_start,
      total_amount: Number(bill.total_amount),
      discount_amount: Number(bill.discount_amount),
      paid_amount: Number(bill.paid_amount),
      status: bill.status,
      due_date: bill.due_date,
      origin: bill.fine_rule_id ? FineOrigin.RULE : FineOrigin.MANUAL,
      approved_by_user_id: bill.approved_by_user_id,
    }));

    return {
      items,
      total,
      totals: {
        charged: Number(totalsRow?.charged ?? 0),
        collected: Number(totalsRow?.collected ?? 0),
        waived: Number(totalsRow?.waived ?? 0),
        outstanding: Number(totalsRow?.outstanding ?? 0),
      },
    };
  }
}
