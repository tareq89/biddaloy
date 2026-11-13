import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import { SmsBundleOrderStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { SmsBundleCatalog } from './sms-bundle-catalog.entity';

/**
 * [100.1.02] One school's purchase of a catalog package. Platform-owned money, so like
 * `seat_orders` the school FK is RESTRICT: a school with an order cannot be deleted.
 * Name, count, validity, price and cost per SMS are snapshots taken at order time.
 */
@Entity('sms_bundle_orders')
@Unique('UQ_sms_bundle_orders_school_idempotency', ['school_id', 'idempotency_key'])
@Index('IDX_sms_bundle_orders_school_status', ['school_id', 'status'])
@Index('UQ_sms_bundle_orders_receipt_number', ['receipt_number'], {
  unique: true,
  where: '"receipt_number" IS NOT NULL',
})
@Check(
  'CHK_sms_bundle_orders_status',
  `"status" IN ('PENDING_PAYMENT','PAID','ACTIVE','USED_UP','EXPIRED','CANCELLED','REFUNDED')`,
)
@Check('CHK_sms_bundle_orders_sms_count', '"sms_count" > 0')
@Check('CHK_sms_bundle_orders_validity', '"validity_days" BETWEEN 1 AND 365')
@Check('CHK_sms_bundle_orders_price', '"price_paisa" BETWEEN 0 AND 9999999999')
@Check('CHK_sms_bundle_orders_cost', '"cost_paisa_per_sms" IS NULL OR "cost_paisa_per_sms" >= 0')
export class SmsBundleOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'school_id' })
  school: School;

  @Column({ type: 'uuid' })
  school_id: string;

  @ManyToOne(() => SmsBundleCatalog, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_id' })
  catalog: SmsBundleCatalog;

  @Column({ type: 'uuid' })
  catalog_id: string;

  @Column({ type: 'varchar', length: 120 })
  name_snapshot: string;

  @Column({ type: 'int' })
  sms_count: number;

  @Column({ type: 'int' })
  validity_days: number;

  @Column({ type: 'bigint' })
  price_paisa: string;

  // NULL when the owner has recorded no stock yet.
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  cost_paisa_per_sms: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: SmsBundleOrderStatus;

  @Column({ type: 'text' })
  idempotency_key: string;

  @Column({ type: 'text', nullable: true })
  receipt_number: string | null;

  @Column({ type: 'jsonb', nullable: true })
  receipt_snapshot: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refunded_at: Date | null;

  @Column({ type: 'text', nullable: true })
  refund_reason: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
