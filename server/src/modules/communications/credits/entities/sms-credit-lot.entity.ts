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
} from 'typeorm';
import { SmsLotSource, SmsLotStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { SmsBundleOrder } from '../../../sms-bundles/entities/sms-bundle-order.entity';

/**
 * [100.1.02] A block of SMS credit with an optional expiry. The four counters always add up
 * to `units_total`. `expires_at` NULL means it never expires (LEGACY and MANUAL lots).
 * One lot per paid bundle order (unique `bundle_order_id`).
 */
@Entity('sms_credit_lots')
@Index('IDX_sms_credit_lots_draw', ['tenant_id', 'expires_at'], { where: '"remaining" > 0' })
@Index('UQ_sms_credit_lots_bundle_order', ['bundle_order_id'], {
  unique: true,
  where: '"bundle_order_id" IS NOT NULL',
})
@Check('CHK_sms_credit_lots_source', `"source" IN ('BUNDLE','MANUAL','LEGACY')`)
@Check('CHK_sms_credit_lots_status', `"status" IN ('ACTIVE','USED_UP','EXPIRED')`)
@Check('CHK_sms_credit_lots_total', '"units_total" > 0')
@Check(
  'CHK_sms_credit_lots_counters',
  '"remaining" >= 0 AND "reserved_units" >= 0 AND "debited_units" >= 0 AND "expired_units" >= 0',
)
@Check(
  'CHK_sms_credit_lots_sum',
  '"remaining" + "reserved_units" + "debited_units" + "expired_units" = "units_total"',
)
@Check('CHK_sms_credit_lots_bundle', `("source" = 'BUNDLE') = ("bundle_order_id" IS NOT NULL)`)
export class SmsCreditLot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 10 })
  source: SmsLotSource;

  @ManyToOne(() => SmsBundleOrder, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bundle_order_id' })
  bundle_order: SmsBundleOrder | null;

  @Column({ type: 'uuid', nullable: true })
  bundle_order_id: string | null;

  @Column({ type: 'int' })
  units_total: number;

  @Column({ type: 'int' })
  remaining: number;

  @Column({ type: 'int', default: 0 })
  reserved_units: number;

  @Column({ type: 'int', default: 0 })
  debited_units: number;

  @Column({ type: 'int', default: 0 })
  expired_units: number;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'varchar', length: 10, default: SmsLotStatus.ACTIVE })
  status: SmsLotStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
