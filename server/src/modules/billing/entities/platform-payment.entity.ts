import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import { PlatformPaymentMethod } from '@biddaloy/shared';
import { SeatOrder } from './seat-order.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A payment against a seat order (gateway callback, offline entry or grant).
 * Platform-owned money: no tenant RLS, no workbook tab (see SeatOrder).
 * `raw` is the gateway payload with secrets redacted before insert.
 */
@Entity('platform_payments')
@Unique('UQ_platform_payments_method_gateway_ref', ['method', 'gateway_ref'])
@Index('IDX_platform_payments_order', ['seat_order_id'])
@Check('CHK_platform_payments_amount', '"amount_paisa" BETWEEN 0 AND 9999999999')
export class PlatformPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => SeatOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seat_order_id' })
  seat_order: SeatOrder;

  @Column({ type: 'uuid' })
  seat_order_id: string;

  @Column({ type: 'enum', enum: PlatformPaymentMethod })
  method: PlatformPaymentMethod;

  // Unique per (method, gateway_ref) when set (Postgres allows many NULLs):
  // replays of one gateway txn collapse; different gateways may reuse a ref.
  @Column({ type: 'text', nullable: true })
  gateway_ref: string | null;

  @Column({ type: 'bigint' })
  amount_paisa: string;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by_user_id' })
  recorded_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  recorded_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
