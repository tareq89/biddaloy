import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { FeeStructure } from './entities/fee-structure.entity';
import { FeeStructureStudent } from './entities/fee-structure-student.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { PaymentStatus } from '@beton-boi/shared';
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
    @InjectRepository(FeeStructureStudent)
    private readonly fssRepo: Repository<FeeStructureStudent>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation)
    private readonly paymentAllocRepo: Repository<PaymentAllocation>,
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async create(dto: CreateFeeStructureDto, tenantId: string): Promise<FeeStructure> {
    // Validate class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
    }

    // Validate section belongs to tenant when provided
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.section_id, class_id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
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

    // Validate student_ids belong to tenant when SELECTED applicability
    if (dto.applicability === 'SELECTED' && dto.student_ids?.length) {
      const studentCount = await this.studentRepo.count({
        where: {
          id: In(dto.student_ids),
          tenant_id: tenantId,
          deleted_at: IsNull(),
        } as any,
      });
      if (studentCount !== dto.student_ids.length) {
        throw new NotFoundException('One or more selected students not found');
      }
    }

    const entity = this.repo.create({
      fee_type: dto.fee_type,
      name: dto.name,
      amount: dto.amount,
      applicability: dto.applicability ?? 'ALL' as any,
      class_id: dto.class_id,
      section_id: dto.section_id ?? null,
      academic_year_id: dto.academic_year_id,
      month: dto.month,
      is_recurring: dto.is_recurring ?? true,
      tenant_id: tenantId,
    });

    const saved = await this.repo.save(entity);

    // If SELECTED applicability, create student links
    if (dto.applicability === 'SELECTED' && dto.student_ids?.length) {
      const entries = dto.student_ids.map((sid) =>
        this.fssRepo.create({ fee_structure_id: saved.id, student_id: sid }),
      );
      await this.fssRepo.save(entries);
    }

    return this.repo.findOne({
      where: { id: saved.id },
      relations: ['class', 'academic_year'],
    }) as Promise<FeeStructure>;
  }

  async findAll(query: QueryFeeStructureDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.academic_year_id) where.academic_year_id = query.academic_year_id;
    if (query.class_id) where.class_id = query.class_id;
    if (query.month) where.month = query.month;

    const [data, total] = await this.repo.findAndCount({
      where,
      relations: ['class', 'academic_year', 'section'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<FeeStructure> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class', 'academic_year', 'section', 'fee_structure_students'],
    });
    if (!entity) {
      throw new NotFoundException(`Fee structure with ID "${id}" not found`);
    }
    return entity;
  }

  async update(id: string, dto: UpdateFeeStructureDto, tenantId: string): Promise<FeeStructure> {
    await this.findOne(id, tenantId);

    const updateData: any = { ...dto };
    if (dto.student_ids !== undefined) {
      delete updateData.student_ids;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    // Replace selected students if provided
    if (dto.student_ids !== undefined) {
      await this.fssRepo.delete({ fee_structure_id: id });
      if (dto.student_ids.length > 0) {
        const entries = dto.student_ids.map((sid) =>
          this.fssRepo.create({ fee_structure_id: id, student_id: sid }),
        );
        await this.fssRepo.save(entries);
      }
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Check if any student_fees reference this fee structure through FeeStructureStudent
    // Since StudentFee doesn't have fee_structure_id, we check if any payments
    // have allocations to student_fees that were generated from this fee structure.
    // Instead, check if any FeeStructureStudent records exist (SELECTED) or
    // if any StudentFee records were generated from this fee structure.
    // The simplest approach: check if any student fees exist for this fee structure's
    // class/academic_year/month combination that have associated payment allocations.
    const studentFees = await this.studentFeeRepo.find({
      where: {
        academic_year_id: (await this.findOne(id, tenantId)).academic_year_id,
        month: (await this.findOne(id, tenantId)).month,
      },
    });

    if (studentFees.length > 0) {
      const studentFeeIds = studentFees.map((sf) => sf.id);
      const allocationCount = await this.paymentAllocRepo.count({
        where: { student_fee_id: In(studentFeeIds) },
      });
      if (allocationCount > 0) {
        throw new ConflictException(
          `Cannot delete fee structure "${id}": ${allocationCount} payment allocation(s) are linked to fees generated from it`,
        );
      }
    }

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
      relations: ['allocations'],
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
      order: { year: 'ASC', month: 'ASC' },
    });

    const totalDue = fees.reduce((sum, f) => sum + Number(f.total_amount), 0);
    const totalPaid = fees.reduce((sum, f) => sum + Number(f.paid_amount), 0);
    const totalDiscount = fees.reduce((sum, f) => sum + Number(f.discount_amount), 0);

    // Get payments for this student
    const payments = await this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
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