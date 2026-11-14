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
import { SmsBundleOrder } from '../../sms-bundles/entities/sms-bundle-order.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A payment against a seat order (gateway callback, offline entry or grant).
 * Platform-owned money: no tenant RLS, no workbook tab (see SeatOrder).
 * `raw` is the gateway payload with secrets redacted before insert.
 */
@Entity('platform_payments')
@Unique('UQ_platform_payments_method_gateway_ref', ['method', 'gateway_ref'])
@Index('IDX_platform_payments_order', ['seat_order_id'])
@Index('IDX_platform_payments_bundle_order', ['bundle_order_id'])
@Check('CHK_platform_payments_amount', '"amount_paisa" BETWEEN 0 AND 9999999999')
@Check(
  'CHK_platform_payments_one_order',
  '("seat_order_id" IS NOT NULL) <> ("bundle_order_id" IS NOT NULL)',
)
export class PlatformPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Exactly one of seat_order_id / bundle_order_id is set (CHK_platform_payments_one_order).
  @ManyToOne(() => SeatOrder, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seat_order_id' })
  seat_order: SeatOrder | null;

  @Column({ type: 'uuid', nullable: true })
  seat_order_id: string | null;

  @ManyToOne(() => SmsBundleOrder, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bundle_order_id' })
  bundle_order: SmsBundleOrder | null;

  @Column({ type: 'uuid', nullable: true })
  bundle_order_id: string | null;

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
