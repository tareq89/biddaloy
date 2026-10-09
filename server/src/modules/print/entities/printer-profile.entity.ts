import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { DuplexOrder, PrinterType } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';

/**
 * [32.1.2] Per-printer calibration: margins, offsets, scale (0.9–1.1, DB
 * CHECK) and duplex order (Epic 32 D17, D39). Numeric columns come back
 * from pg as strings; the service layer converts. Names are unique per
 * tenant among non-archived rows (partial index in the migration).
 */
@Entity('printer_profiles')
@Index(['tenant_id'])
export class PrinterProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  printer_type: PrinterType;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  margin_top_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  margin_right_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  margin_bottom_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  margin_left_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  offset_x_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  offset_y_mm: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: 1 })
  scale: string;

  @Column({ type: 'varchar', length: 20, default: 'INTERLEAVED' })
  duplex_order: DuplexOrder;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 2 })
  sheet_gap_mm: string;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
