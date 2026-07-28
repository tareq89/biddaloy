import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, IsNull } from "typeorm";
import { Payment } from "./entities/payment.entity";
import { PaymentAllocation } from "./entities/payment-allocation.entity";
import { StudentFee } from "./entities/student-fee.entity";
import { Student } from "../students/entities/student.entity";
import { Invoice } from "../invoices/entities/invoice.entity";
import { AuditLog } from "../audit/entities/audit-log.entity";
import { FeeStatus, InvoiceStatus, PaymentAllocationType, PaymentStatus, AuditAction } from "@beton-boi/shared";
import { RecordPaymentWithAllocationDto } from "./dto/fees.dto";
import { generateInvoiceNumber } from "../invoices/invoice-numbering.util";

const AMOUNT_EPSILON = 0.01;

/**
 * Records a payment split across a student's fee periods (dues, current
 * month, advance) and applies it to StudentFee/Invoice/AuditLog atomically.
 *
 * The caller submits the exact per-period breakdown (allocations), but the
 * server is the source of truth for whether that breakdown is valid: it
 * independently re-derives each fee's expected bucket (DUE/CURRENT/ADVANCE)
 * from today's date and enforces that older outstanding fees are always
 * settled before newer ones — a client can never skip an overdue fee to pay
 * a later one.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async recordWithAllocation(
    dto: RecordPaymentWithAllocationDto,
    tenantId: string,
    userId: string,
  ): Promise<Payment> {
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }

    const allocationSum = dto.allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
    if (Math.abs(allocationSum - Number(dto.total_amount)) > AMOUNT_EPSILON) {
      throw new BadRequestException(
        `Allocation amounts (${allocationSum.toFixed(2)}) must sum to total_amount (${Number(dto.total_amount).toFixed(2)})`,
      );
    }

    const feeIds = dto.allocations.map((a) => a.student_fee_id);
    if (new Set(feeIds).size !== feeIds.length) {
      throw new BadRequestException("Duplicate student_fee_id in allocations");
    }

    const paymentId = await this.paymentRepo.manager.transaction(async (manager) => {
      const studentFeeRepo = manager.getRepository(StudentFee);
      const paymentRepo = manager.getRepository(Payment);
      const allocationRepo = manager.getRepository(PaymentAllocation);
      const invoiceRepo = manager.getRepository(Invoice);
      const auditLogRepo = manager.getRepository(AuditLog);

      // Lock every outstanding fee for this student so two concurrent
      // payments can't both allocate against the same balance.
      const outstandingFees = await studentFeeRepo
        .createQueryBuilder("sf")
        .where("sf.student_id = :studentId", { studentId: dto.student_id })
        .andWhere("sf.status IN (:...statuses)", {
          statuses: [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE],
        })
        .orderBy("sf.year", "ASC")
        .addOrderBy("sf.month", "ASC")
        .setLock("pessimistic_write")
        .getMany();

      const outstandingById = new Map(outstandingFees.map((f) => [f.id, f]));
      for (const feeId of feeIds) {
        if (!outstandingById.has(feeId)) {
          throw new NotFoundException(
            `Student fee "${feeId}" not found, already paid, or does not belong to this student`,
          );
        }
      }
      const allocationsByFeeId = new Map(dto.allocations.map((a) => [a.student_fee_id, a]));

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      let blocked = false;
      const feeUpdates: { fee: StudentFee; newPaid: number; newStatus: FeeStatus; allocatedAmount: number }[] = [];

      for (const fee of outstandingFees) {
        const remaining = Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
        if (remaining <= AMOUNT_EPSILON) {
          if (allocationsByFeeId.has(fee.id)) {
            throw new BadRequestException(
              `Fee for ${fee.month}/${fee.year} has no outstanding balance and cannot be allocated against`,
            );
          }
          continue;
        }

        const alloc = allocationsByFeeId.get(fee.id);
        if (!alloc) {
          blocked = true;
          continue;
        }
        if (blocked) {
          throw new BadRequestException(
            `FIFO violation: fee for ${fee.month}/${fee.year} was allocated before an earlier outstanding fee was fully settled`,
          );
        }

        const expectedType = this.classifyPeriod(fee.year, fee.month, currentYear, currentMonth);
        if (alloc.allocation_type !== expectedType) {
          throw new BadRequestException(
            `Fee for ${fee.month}/${fee.year} must use allocation_type "${expectedType}", got "${alloc.allocation_type}"`,
          );
        }

        const allocAmount = Number(alloc.allocated_amount);
        if (allocAmount > remaining + AMOUNT_EPSILON) {
          throw new BadRequestException(
            `Allocated amount ${allocAmount} exceeds remaining balance ${remaining} for fee ${fee.month}/${fee.year}`,
          );
        }

        const newPaid = Number(fee.paid_amount) + allocAmount;
        const newStatus =
          newPaid + Number(fee.discount_amount) >= Number(fee.total_amount) - AMOUNT_EPSILON
            ? FeeStatus.PAID
            : FeeStatus.PARTIALLY_PAID;

        feeUpdates.push({ fee, newPaid, newStatus, allocatedAmount: allocAmount });

        if (allocAmount < remaining - AMOUNT_EPSILON) {
          // Ran out of money on this fee — nothing further may be allocated.
          blocked = true;
        }
      }

      const payment = paymentRepo.create({
        student_id: dto.student_id,
        total_amount: dto.total_amount,
        payment_method: dto.payment_method,
        payment_status: PaymentStatus.SUCCESS,
        transaction_reference: dto.transaction_reference ?? null,
        remarks: dto.remarks ?? null,
        received_by_user_id: userId,
        payment_date: now,
        tenant_id: tenantId,
      });
      const savedPayment = await paymentRepo.save(payment);

      await allocationRepo.save(
        feeUpdates.map((u) =>
          allocationRepo.create({
            payment_id: savedPayment.id,
            student_fee_id: u.fee.id,
            allocated_amount: u.allocatedAmount,
            allocation_type: allocationsByFeeId.get(u.fee.id)!.allocation_type,
          }),
        ),
      );

      for (const { fee, newPaid, newStatus } of feeUpdates) {
        await studentFeeRepo.update(fee.id, { paid_amount: newPaid, status: newStatus });
      }

      await auditLogRepo.save(
        auditLogRepo.create({
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: "Payment",
          entity_id: savedPayment.id,
          performed_by_user_id: userId,
          new_values: {
            student_id: dto.student_id,
            total_amount: dto.total_amount,
            payment_method: dto.payment_method,
            allocations: feeUpdates.map((u) => ({
              student_fee_id: u.fee.id,
              allocated_amount: u.allocatedAmount,
              allocation_type: allocationsByFeeId.get(u.fee.id)!.allocation_type,
            })),
          },
        }),
      );

      const isFullPayment = feeUpdates.length > 0 && feeUpdates.every((u) => u.newStatus === FeeStatus.PAID);
      if (isFullPayment && dto.generate_invoice !== false) {
        const invoiceNumber = await generateInvoiceNumber(invoiceRepo);
        const lineItems = feeUpdates.map((u) => ({
          description: `Fee for ${u.fee.month}/${u.fee.year}`,
          amount: u.allocatedAmount,
          quantity: 1,
          total: u.allocatedAmount,
        }));

        const invoice = await invoiceRepo.save(
          invoiceRepo.create({
            invoice_number: invoiceNumber,
            student_id: dto.student_id,
            student_fee_id: feeUpdates.length === 1 ? feeUpdates[0].fee.id : null,
            total_amount: dto.total_amount,
            tax_amount: 0,
            discount_amount: 0,
            status: InvoiceStatus.ISSUED,
            issued_date: now,
            due_date: now,
            line_items: lineItems,
            issued_by_user_id: userId,
          }),
        );
        await paymentRepo.update(savedPayment.id, { invoice_id: invoice.id });

        await auditLogRepo.save(
          auditLogRepo.create({
            action: AuditAction.INVOICE_GENERATED,
            entity_type: "Invoice",
            entity_id: invoice.id,
            performed_by_user_id: userId,
            new_values: { invoice_number: invoiceNumber, payment_id: savedPayment.id, total_amount: dto.total_amount },
          }),
        );
      }

      return savedPayment.id;
    });

    return this.paymentRepo.findOneOrFail({
      where: { id: paymentId },
      relations: ["allocations", "allocations.student_fee", "invoice"],
    });
  }

  private classifyPeriod(
    year: number,
    month: number,
    currentYear: number,
    currentMonth: number,
  ): PaymentAllocationType {
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      return PaymentAllocationType.DUE;
    }
    if (year === currentYear && month === currentMonth) {
      return PaymentAllocationType.CURRENT;
    }
    return PaymentAllocationType.ADVANCE;
  }
}
