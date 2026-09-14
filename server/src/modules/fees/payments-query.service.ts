import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { QueryPaymentDto, PaymentDetailDto } from './dto/fees.dto';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';

export interface PaginatedPayments {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * [16.4.3] `GET /payments` filters and `GET /payments/:id` detail.
 *
 * Replaces `PaymentService.findAll`'s `search`-only query behind the same
 * route. `PaymentAllocation` carries no `fee_name`/`period_start` of its
 * own — both queries here join `student_fee` → `fee_structure` at read time
 * to derive them, guarding every soft-deletable relation (`student`,
 * `student_fee`, `fee_structure`, `invoice`, `received_by`, `approved_by`)
 * with an explicit `deleted_at IS NULL` on the join, since TypeORM's
 * soft-delete filtering only applies automatically to the top-level
 * `find()`/`findOne()` entity, not to relations loaded through a manual
 * `createQueryBuilder` join.
 */
@Injectable()
export class PaymentsQueryService {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  async findAll(query: QueryPaymentDto, tenantId: string): Promise<PaginatedPayments> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const sortOrder = query.sort_order ?? 'DESC';

    const qb = this.repo
      .createQueryBuilder('payment')
      // Guards the join, not the payment row: a payment whose student was
      // later soft-deleted still appears in the list (money-tier data is
      // never silently hidden) with `student: null` instead of the deleted
      // student's row. Any client consuming this list must null-check
      // `student` — see the w4-g2 client lane.
      .leftJoinAndSelect('payment.student', 'student', 'student.deleted_at IS NULL')
      .where('payment.tenant_id = :tenantId', { tenantId })
      .andWhere('payment.deleted_at IS NULL');

    const search = normalizeSearchTerm(query.search);
    if (search) {
      qb.andWhere(
        '(payment.transaction_reference ILIKE :search OR student.full_name ILIKE :search OR student.registration_number ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (query.student_id) {
      qb.andWhere('payment.student_id = :studentId', { studentId: query.student_id });
    }

    if (query.payment_method) {
      qb.andWhere('payment.payment_method = :paymentMethod', {
        paymentMethod: query.payment_method,
      });
    }

    if (query.received_by_user_id) {
      qb.andWhere('payment.received_by_user_id = :receivedBy', {
        receivedBy: query.received_by_user_id,
      });
    }

    // `date_from`/`date_to` arrive as `YYYY-MM-DD` (IsDateString). Postgres
    // casts a bare date string to that day's midnight UTC, so an inclusive
    // upper bound needs the day pushed to its last instant — same pattern
    // as `audit.service.ts`'s `to_date` handling. `date_from` is left at
    // midnight UTC: a payment recorded 00:00-06:00 Dhaka time (UTC+6) on
    // the start day falls *before* midnight UTC of that day and would be
    // excluded — a known caveat (see the boundary test in
    // `payments-query.service.integration.spec.ts`) not fixed here because
    // it needs the tenant-timezone plumbing `checkout-cart.service.ts`'s
    // `SCHOOL_TIMEZONE` uses, which is out of this fix's scope.
    if (query.date_from) {
      qb.andWhere('payment.payment_date >= :dateFrom', { dateFrom: query.date_from });
    }

    if (query.date_to) {
      const dateTo = new Date(query.date_to);
      dateTo.setUTCHours(23, 59, 59, 999);
      qb.andWhere('payment.payment_date <= :dateTo', { dateTo });
    }

    if (query.is_reversal !== undefined) {
      qb.andWhere(
        query.is_reversal
          ? 'payment.reversal_of_payment_id IS NOT NULL'
          : 'payment.reversal_of_payment_id IS NULL',
      );
    }

    // A payment that has itself been reversed (`reversed_by_payment_id`
    // set) is excluded by default — it and its reversal would otherwise
    // both appear and double-count on the list view.
    if (!query.include_reversed) {
      qb.andWhere('payment.reversed_by_payment_id IS NULL');
    }

    // Deterministic pagination: `payment_date` alone isn't unique, so ties
    // (same-second payments) would otherwise reorder across pages under
    // concurrent inserts. `payment.id` breaks ties stably.
    qb.orderBy('payment.payment_date', sortOrder).addOrderBy('payment.id', 'ASC');

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<PaymentDetailDto> {
    const payment = await this.repo
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.student', 'student', 'student.deleted_at IS NULL')
      .leftJoinAndSelect('payment.invoice', 'invoice', 'invoice.deleted_at IS NULL')
      .leftJoinAndSelect('payment.received_by', 'received_by', 'received_by.deleted_at IS NULL')
      .leftJoinAndSelect('payment.approved_by', 'approved_by', 'approved_by.deleted_at IS NULL')
      .leftJoinAndSelect('payment.allocations', 'allocation')
      .leftJoinAndSelect('allocation.student_fee', 'student_fee', 'student_fee.deleted_at IS NULL')
      .leftJoinAndSelect(
        'student_fee.fee_structure',
        'fee_structure',
        'fee_structure.deleted_at IS NULL',
      )
      .where('payment.id = :id', { id })
      .andWhere('payment.tenant_id = :tenantId', { tenantId })
      .andWhere('payment.deleted_at IS NULL')
      .getOne();

    if (!payment) {
      throw new NotFoundException(`Payment with ID "${id}" not found`);
    }

    return this.toDetailDto(payment);
  }

  private toDetailDto(payment: Payment): PaymentDetailDto {
    return {
      id: payment.id,
      student_id: payment.student_id,
      student: payment.student
        ? { id: payment.student.id, full_name: payment.student.full_name }
        : null,
      // Postgres numeric/decimal columns come back as strings via TypeORM;
      // wrap with Number() so the DTO's declared `number` type matches its
      // actual runtime value — same pattern as checkout.service.ts.
      total_amount: Number(payment.total_amount),
      payment_method: payment.payment_method,
      payment_status: payment.payment_status,
      transaction_reference: payment.transaction_reference,
      payment_date: payment.payment_date,
      remarks: payment.remarks,
      invoice: payment.invoice
        ? {
            id: payment.invoice.id,
            invoice_number: payment.invoice.invoice_number,
            status: payment.invoice.status,
          }
        : null,
      received_by: payment.received_by
        ? { id: payment.received_by.id, full_name: payment.received_by.full_name }
        : null,
      approved_by: payment.approved_by
        ? { id: payment.approved_by.id, full_name: payment.approved_by.full_name }
        : null,
      reversal_of_payment_id: payment.reversal_of_payment_id,
      reversed_by_payment_id: payment.reversed_by_payment_id,
      allocations: (payment.allocations ?? []).map((a) => ({
        id: a.id,
        student_fee_id: a.student_fee_id,
        allocated_amount: Number(a.allocated_amount),
        allocation_type: a.allocation_type,
        discount_amount: Number(a.discount_amount),
        fee_name: a.student_fee?.fee_structure?.name ?? null,
        period_start: a.student_fee?.period_start ?? null,
      })),
      created_at: payment.created_at,
    };
  }
}
