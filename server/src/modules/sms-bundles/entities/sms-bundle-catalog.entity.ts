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
import { User } from '../../users/entities/user.entity';

/**
 * [100.1.02] The package catalog the owner sells SMS bundles from. Platform-owned (no tenant).
 * An order snapshots name, count, validity and price, so editing a package never changes a past order.
 */
@Entity('sms_bundle_catalog')
@Index('UQ_sms_bundle_catalog_active_name', { synchronize: false })
@Check('CHK_sms_bundle_catalog_sms_count', '"sms_count" BETWEEN 100 AND 1000000')
@Check('CHK_sms_bundle_catalog_validity', '"validity_days" BETWEEN 1 AND 365')
@Check('CHK_sms_bundle_catalog_price', '"price_paisa" BETWEEN 0 AND 9999999999')
export class SmsBundleCatalog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'int' })
  sms_count: number;

  @Column({ type: 'int' })
  validity_days: number;

  @Column({ type: 'bigint' })
  price_paisa: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

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
