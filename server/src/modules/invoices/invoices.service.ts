import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentAllocation } from '../fees/entities/payment-allocation.entity';
import { InvoiceStatus } from '@biddaloy/shared';
import { CreateInvoiceDto, QueryInvoiceDto } from './dto/invoices.dto';
import { generateInvoiceNumber } from './invoice-numbering.util';
import { renderInvoiceHtml } from './invoice-print.template';

const AMOUNT_EPSILON = 0.01;
const DEFAULT_DUE_DAYS = 7;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly repo: Repository<Invoice>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  private async findStudentForTenant(studentId: string, tenantId: string): Promise<Student> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    return student;
  }

  async create(dto: CreateInvoiceDto, tenantId: string, userId: string): Promise<Invoice> {
    const student = await this.findStudentForTenant(dto.student_id, tenantId);

    let studentFee: StudentFee | null = null;
    if (dto.student_fee_id) {
      studentFee = await this.studentFeeRepo.findOne({
        where: { id: dto.student_fee_id, student_id: dto.student_id },
      });
      if (!studentFee) {
        throw new NotFoundException(
          `Student fee "${dto.student_fee_id}" not found for this student`,
        );
      }
    }

    const lineItems = dto.line_items
      ? dto.line_items.map((item) => ({
          description: item.description,
          amount: item.amount,
          quantity: item.quantity ?? 1,
          total: item.amount * (item.quantity ?? 1),
        }))
      : studentFee
        ? [
            {
              description: `Fee for ${studentFee.month}/${studentFee.year}`,
              amount: Number(studentFee.total_amount),
              quantity: 1,
              total: Number(studentFee.total_amount),
            },
          ]
        : null;

    if (!lineItems || lineItems.length === 0) {
      throw new BadRequestException('Either student_fee_id or line_items must be provided');
    }

    const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);
    if (totalAmount <= AMOUNT_EPSILON) {
      throw new BadRequestException('Invoice total must be greater than zero');
    }

    const now = new Date();
    const dueDate = dto.due_date
      ? new Date(dto.due_date)
      : new Date(now.getTime() + DEFAULT_DUE_DAYS * 86400000);

    const invoiceId = await this.repo.manager.transaction(async (manager) => {
      const invoiceRepo = manager.getRepository(Invoice);
      const invoiceNumber = await generateInvoiceNumber(invoiceRepo);

      const invoice = await invoiceRepo.save(
        invoiceRepo.create({
          invoice_number: invoiceNumber,
          student_id: student.id,
          student_fee_id: studentFee?.id ?? null,
          total_amount: totalAmount,
          tax_amount: 0,
          discount_amount: 0,
          status: InvoiceStatus.ISSUED,
          issued_date: now,
          due_date: dueDate,
          line_items: lineItems,
          issued_by_user_id: userId,
          notes: dto.notes ?? null,
        }),
      );
      return invoice.id;
    });

    return this.findOne(invoiceId, tenantId);
  }

  async findOne(id: string, tenantId: string): Promise<Invoice> {
    const invoice = await this.repo.findOne({
      where: { id, deleted_at: IsNull() },
      relations: ['student', 'student_fee', 'issued_by'],
    });
    if (!invoice || invoice.student.tenant_id !== tenantId) {
      throw new NotFoundException(`Invoice with ID "${id}" not found`);
    }
    return invoice;
  }

  async findAll(query: QueryInvoiceDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.student', 'student')
      .leftJoinAndSelect('invoice.student_fee', 'student_fee')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('invoice.deleted_at IS NULL')
      .orderBy('invoice.issued_date', 'DESC');

    if (query.search) {
      qb.andWhere('(invoice.invoice_number ILIKE :search OR student.full_name ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }
    if (query.student_id) {
      qb.andWhere('invoice.student_id = :studentId', { studentId: query.student_id });
    }
    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    if (query.from_date) {
      qb.andWhere('invoice.issued_date >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      qb.andWhere('invoice.issued_date <= :toDate', { toDate: query.to_date });
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPrintableHtml(id: string, tenantId: string): Promise<string> {
    const invoice = await this.repo.findOne({
      where: { id, deleted_at: IsNull() },
      relations: [
        'student',
        'student.tenant',
        'student.class_section',
        'student.class_section.class',
        'student_fee',
      ],
    });
    if (!invoice || invoice.student.tenant_id !== tenantId) {
      throw new NotFoundException(`Invoice with ID "${id}" not found`);
    }

    const payments = invoice.student_fee_id
      ? await this.paymentRepo
          .createQueryBuilder('payment')
          .innerJoin(PaymentAllocation, 'allocation', 'allocation.payment_id = payment.id')
          .where('allocation.student_fee_id = :studentFeeId', {
            studentFeeId: invoice.student_fee_id,
          })
          .orderBy('payment.payment_date', 'DESC')
          .getMany()
      : await this.paymentRepo.find({
          where: { invoice_id: invoice.id, deleted_at: IsNull() },
          order: { payment_date: 'DESC' },
        });

    return renderInvoiceHtml(invoice, payments);
  }
}
