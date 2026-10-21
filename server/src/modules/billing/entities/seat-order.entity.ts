import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { SeatOrderStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A school's purchase of seats for a period (Epic 49).
 *
 * Platform-owned money: no tenant RLS and no workbook tab. `school_id`
 * (not `tenant_id`) names the buyer; only platform/billing code reads it,
 * always filtered by the caller's school. Amounts are integer paisa.
 * Bounds (seats >= 1, months 1-24, amount 0..MONEY_MAX*100) are CHECK
 * constraints in the migration, not just DTO rules.
 */
@Entity('seat_orders')
@Index('IDX_seat_orders_school_status_period', ['school_id', 'status', 'period_end'])
@Index('UQ_seat_orders_receipt_number', ['receipt_number'], {
  unique: true,
  where: '"receipt_number" IS NOT NULL',
})
@Unique('UQ_seat_orders_school_idempotency', ['school_id', 'idempotency_key'])
@Check('CHK_seat_orders_seats', '"seats" >= 1')
@Check('CHK_seat_orders_months', '"months" BETWEEN 1 AND 24')
@Check('CHK_seat_orders_unit_price', '"unit_price_paisa" >= 0')
@Check('CHK_seat_orders_amount', '"amount_paisa" BETWEEN 0 AND 9999999999')
@Check('CHK_seat_orders_period', '"period_end" >= "period_start"')
export class SeatOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'school_id' })
  school: School;

  @Column({ type: 'uuid' })
  school_id: string;

  @Column({ type: 'int' })
  seats: number;

  @Column({ type: 'int' })
  months: number;

  @Column({ type: 'int' })
  unit_price_paisa: number;

  // bigint comes back from pg as a string.
  @Column({ type: 'bigint' })
  amount_paisa: string;

  @Column({ type: 'date' })
  period_start: string;

  @Column({ type: 'date' })
  period_end: string;

  @Column({ type: 'enum', enum: SeatOrderStatus })
  status: SeatOrderStatus;

  @Column({ type: 'text' })
  idempotency_key: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  /** `SMR-YYYY-NNNNNN`, set at payment; NULL while unpaid and for GRANTs. */
  @Column({ type: 'text', nullable: true })
  receipt_number: string | null;

  /** What the receipt shows, frozen at payment: `{ name, address, vat }`. */
  @Column({ type: 'jsonb', nullable: true })
  receipt_snapshot: { name: string; address: string | null; vat: string | null } | null;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
