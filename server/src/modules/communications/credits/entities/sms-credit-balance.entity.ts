import { Entity, PrimaryColumn, Column, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { School } from '../../../schools/entities/school.entity';

/**
 * Per-tenant running SMS credit balance, kept in sync with
 * `sms_credit_ledger` on every write (never computed on read — see the
 * service in #546). `tenant_id` is the primary key: one row per tenant,
 * created lazily on first credit movement — no row means a tenant has
 * never had a credit event (equivalent to 0/0 for metering purposes).
 *
 * Relations:
 * - @OneToOne → School: the tenant this balance belongs to.
 */
@Entity('sms_credit_balance')
export class SmsCreditBalance {
  @OneToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @PrimaryColumn({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'int', default: 0 })
  available: number;

  @Column({ type: 'int', default: 0 })
  reserved: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
