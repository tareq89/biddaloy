import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { GuardianService } from '../students/students.service';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { PaymentStatus, AuditAction } from '@biddaloy/shared';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  QueryFeeStructureDto,
  CreatePaymentDto,
  QueryPaymentDto,
} from './dto/fees.dto';

@Injectable()
export class FeeStructureService {
  constructor(
    @InjectRepository(FeeStructure)
    private readonly repo: Repository<FeeStructure>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateFeeStructureDto, tenantId: string): Promise<FeeStructure> {
    // Validate class belongs to tenant, when provided — a fee structure is
    // now school-wide by default and only optionally labelled with a class.
    if (dto.class_id) {
      const cls = await this.classRepo.findOne({
        where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!cls) {
        throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
      }
    }

    // A section is only a meaningful label when paired with the class it
    // belongs to — a section without a class would surface under every
    // class via the `class_id IS NULL` picker rule below, which is not a
    // real school-wide structure.
    if (dto.section_id && !dto.class_id) {
      throw new NotFoundException(`Section with ID "${dto.section_id}" not found`);
    }

    // Validate section belongs to tenant when provided. `dto.class_id` is
    // guaranteed truthy here — the check above already rejected a
    // `section_id` with no `class_id`.
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: {
          id: dto.section_id,
          class_id: dto.class_id as string,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found`);
      }
    }

    // Validate academic year belongs to tenant
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    const entity = this.repo.create({
      fee_type: dto.fee_type,
      name: dto.name,
      amount: dto.amount,
      class_id: dto.class_id ?? null,
      section_id: dto.section_id ?? null,
      academic_year_id: dto.academic_year_id,
      tenant_id: tenantId,
    });

    const saved = await this.repo.save(entity);

    return this.repo.findOne({
      where: { id: saved.id },
      relations: ['class', 'academic_year'],
    }) as Promise<FeeStructure>;
  }

  async findAll(query: QueryFeeStructureDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Two-phase (IDs, then hydrate) rather than one query with
    // `leftJoinAndSelect` + `skip`/`take`: TypeORM's own pagination-with-
    // joins path can't resolve a `COLLATE`-suffixed `orderBy` expression
    // against its select-alias map (it throws trying to read
    // `column.databaseName` for a "column" that doesn't exist, since the
    // expression isn't a plain `alias.property`), and even without that
    // bug, `LIMIT` on the joined+flattened rows would apply before
    // collapsing, breaking pagination arithmetic once a fee structure has
    // more than one joined row anywhere in this query.
    const buildIdQuery = () => {
      const qb = this.repo
        .createQueryBuilder('fee_structure')
        .select('fee_structure.id', 'id')
        .where('fee_structure.tenant_id = :tenantId', { tenantId });

      if (query.include_deleted) {
        // TypeORM's soft-delete extension auto-appends `deleted_at IS NULL`
        // to every query on an entity with a `@DeleteDateColumn` unless
        // `withDeleted()` is called — the manual `andWhere` below is a no-op
        // without this.
        qb.withDeleted();
      } else {
        qb.andWhere('fee_structure.deleted_at IS NULL');
      }

      if (query.academic_year_id) {
        qb.andWhere('fee_structure.academic_year_id = :academicYearId', {
          academicYearId: query.academic_year_id,
        });
      }
      if (query.class_id) {
        // Picker ordering (D3): a class-scoped filter should still surface
        // school-wide structures (`class_id IS NULL`) — they apply to every
        // class — alongside the ones scoped to this exact class.
        qb.andWhere('(fee_structure.class_id = :classId OR fee_structure.class_id IS NULL)', {
          classId: query.class_id,
        });
      }
      if (query.fee_type) {
        qb.andWhere('fee_structure.fee_type = :feeType', { feeType: query.fee_type });
      }
      if (query.section_id) {
        qb.andWhere('fee_structure.section_id = :sectionId', { sectionId: query.section_id });
      }

      const search = normalizeSearchTerm(query.search);
      if (search) {
        qb.andWhere('fee_structure.name ILIKE :search', { search: `%${search}%` });
      }

      return qb;
    };

    const total = await buildIdQuery().getCount();

    const idQb = buildIdQuery();
    if (query.class_id) {
      // Picker ordering (D3): class-matching rows before school-wide
      // (`class_id IS NULL`) rows, so the exact-match structures a caller
      // filtered for don't get buried under generic ones.
      idQb.addSelect(
        `CASE WHEN fee_structure.class_id = :classId THEN 0 ELSE 1 END`,
        'class_match_rank',
      );
      idQb.orderBy('class_match_rank', 'ASC');
    }
    if (query.sort === 'name') {
      idQb.addOrderBy(
        `fee_structure.name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else if (query.sort === 'amount') {
      idQb.addOrderBy('fee_structure.amount', query.order === 'asc' ? 'ASC' : 'DESC');
    } else {
      idQb.addOrderBy('fee_structure.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    idQb.addOrderBy('fee_structure.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const rows = await this.repo.find({
      // `tenant_id` is redundant here — `ids` already came from the
      // tenant-scoped ID query above — but it costs nothing and keeps this
      // query tenant-scoped on its own terms rather than only by
      // construction, per the multi-tenancy skill's "new query" checklist.
      where: { id: In(ids), tenant_id: tenantId },
      relations: ['class', 'academic_year', 'section'],
      withDeleted: !!query.include_deleted,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is FeeStructure => row != null);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<FeeStructure> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class', 'academic_year', 'section'],
    });
    if (!entity) {
      throw new NotFoundException(`Fee structure with ID "${id}" not found`);
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdateFeeStructureDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<FeeStructure> {
    const updateData: any = { ...dto };
    const changedKeys = Object.keys(updateData);

    // One transaction for the locked read, the update, and the audit write:
    // without it, a concurrent PATCH could read a stale `amount` between
    // this read and its own write, and an audit-write failure could leave
    // the fee change committed with no record of it. AuditService.record()
    // gets this same manager, so its write commits or rolls back atomically
    // with everything else here.
    await this.repo.manager.transaction(async (manager) => {
      const feeRepo = manager.getRepository(FeeStructure);

      const existing = await feeRepo
        .createQueryBuilder('fs')
        .where('fs.id = :id', { id })
        .andWhere('fs.tenant_id = :tenantId', { tenantId })
        .andWhere('fs.deleted_at IS NULL')
        .setLock('pessimistic_write')
        .getOne();
      if (!existing) {
        throw new NotFoundException(`Fee structure with ID "${id}" not found`);
      }

      // `class_id`/`section_id` are now writable on update (they weren't
      // before this ticket) — validate them the same way `create()` does,
      // against the effective (possibly unchanged) value, or a tenant could
      // PATCH in another tenant's class/section id and read it back through
      // the `relations: ['class', 'section']` join.
      const effectiveClassId = changedKeys.includes('class_id') ? dto.class_id : existing.class_id;
      const effectiveSectionId = changedKeys.includes('section_id')
        ? dto.section_id
        : existing.section_id;

      if (changedKeys.includes('class_id') && effectiveClassId) {
        const cls = await manager.getRepository(Class).findOne({
          where: { id: effectiveClassId, tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (!cls) {
          throw new NotFoundException(`Class with ID "${effectiveClassId}" not found`);
        }
      }
      if (effectiveSectionId) {
        if (!effectiveClassId) {
          throw new NotFoundException(`Section with ID "${effectiveSectionId}" not found`);
        }
        if (changedKeys.includes('section_id') || changedKeys.includes('class_id')) {
          const section = await manager.getRepository(ClassSection).findOne({
            where: {
              id: effectiveSectionId,
              class_id: effectiveClassId,
              tenant_id: tenantId,
              deleted_at: IsNull(),
            },
          });
          if (!section) {
            throw new NotFoundException(`Section with ID "${effectiveSectionId}" not found`);
          }
        }
      }

      await feeRepo.update({ id, tenant_id: tenantId }, updateData);

      // Amount edits are the only fee-structure change worth an audit trail
      // (D7): they change what a family owes, everything else is a label.
      // Guard on an actual change, not mere presence in the payload, so a
      // no-op PATCH (amount resubmitted unchanged) doesn't write a false
      // old===new audit row.
      if (changedKeys.includes('amount') && Number(existing.amount) !== Number(updateData.amount)) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'FeeStructure',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { amount: existing.amount },
            new_values: { amount: updateData.amount },
          },
          manager,
        );
      }
    });

    const updated = await this.findOne(id, tenantId);

    return updated;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    // Soft-delete only, even when StudentFee rows reference this structure —
    // history keeps pointing at the (now-hidden) price tag that generated
    // them, rather than blocking removal or dragging billed data down with
    // it.
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly guardianService: GuardianService,
  ) {}

  async create(dto: CreatePaymentDto, tenantId: string, userId?: string): Promise<Payment> {
    // Verify student belongs to tenant (via class_section -> class chain)
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }

    const entity = this.repo.create({
      student_id: dto.student_id,
      total_amount: dto.total_amount,
      payment_method: dto.payment_method,
      payment_status: dto.payment_status ?? PaymentStatus.SUCCESS,
      transaction_reference: dto.transaction_reference ?? null,
      remarks: dto.remarks ?? null,
      received_by_user_id: userId ?? null,
      payment_date: dto.payment_date ? new Date(dto.payment_date) : new Date(),
      tenant_id: tenantId,
    });

    return this.repo.save(entity);
  }

  // [16.4.3] Superseded by `PaymentsQueryService.findAll` — `GET /payments`
  // is wired to that service now. Kept only because
  // `fees.service.integration.spec.ts` still exercises this method
  // directly; not wired to any route.
  async findAll(query: QueryPaymentDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.student', 'student')
      .where('payment.tenant_id = :tenantId', { tenantId })
      .andWhere('payment.deleted_at IS NULL')
      .orderBy('payment.payment_date', 'DESC');

    if (query.search) {
      qb.andWhere(
        '(payment.transaction_reference ILIKE :search OR student.full_name ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByStudent(studentId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    return this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      // `allocations.student_fee.fee_structure` is what lets
      // `toFamilyPayment()` (called on this result for PARENT/STUDENT
      // callers) fill in `fee_name`/`period_start` — without it those
      // fields are always null even when the underlying data exists.
      relations: [
        'allocations',
        'allocations.student_fee',
        'allocations.student_fee.fee_structure',
      ],
      order: { payment_date: 'DESC' },
    });
  }

  /** [8.11.4]'s Payment History tab — every payment recorded for any of a
   * guardian's linked students, newest first. `GuardianService.findOne`
   * throws `NotFoundException` for a guardian outside this tenant, so a
   * cross-tenant guardian ID never falls through to the payments query.
   * One `IN (...)` query over the guardian's `student_ids`, not a
   * per-student loop. */
  async findByGuardian(guardianId: string, tenantId: string) {
    const guardian = await this.guardianService.findOne(guardianId, tenantId);
    const studentIds = (guardian.students ?? []).map((s) => s.id);

    if (studentIds.length === 0) {
      return [];
    }

    return this.repo.find({
      where: { student_id: In(studentIds), tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['allocations', 'student'],
      order: { payment_date: 'DESC' },
    });
  }

  async getInvoiceSummary(studentId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    // Get fee summaries from StudentFee table
    const studentFeeRepo = this.repo.manager.getRepository(StudentFee);
    const fees = await studentFeeRepo.find({
      where: { student_id: studentId },
      relations: ['fee_structure'],
      order: { year: 'ASC', month: 'ASC' },
    });

    const totalDue = fees.reduce((sum, f) => sum + Number(f.total_amount), 0);
    const totalPaid = fees.reduce((sum, f) => sum + Number(f.paid_amount), 0);
    const totalDiscount = fees.reduce((sum, f) => sum + Number(f.discount_amount), 0);

    // Get payments for this student — same `allocations.student_fee.fee_structure`
    // join as `findByStudent` above, needed for `toFamilyPayment()`'s
    // fee_name/period_start on the family-facing `getInvoiceSummary` response.
    const payments = await this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      relations: [
        'allocations',
        'allocations.student_fee',
        'allocations.student_fee.fee_structure',
      ],
      order: { payment_date: 'DESC' },
    });

    return {
      student_id: studentId,
      student_name: student.full_name,
      summary: {
        total_due: totalDue,
        total_paid: totalPaid,
        total_discount: totalDiscount,
        balance: totalDue - totalPaid - totalDiscount,
      },
      fee_breakdown: fees,
      payments,
    };
  }
}
