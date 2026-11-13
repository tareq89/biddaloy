import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [100.1.02] An SMS stock purchase the owner recorded (what a bought block cost). Soft-deleted with a reason. */
@Entity('sms_stock_entries')
@Check('CHK_sms_stock_entries_count', '"sms_count" > 0')
@Check('CHK_sms_stock_entries_cost', '"cost_paisa" BETWEEN 0 AND 9999999999')
export class SmsStockEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  bought_on: string;

  @Column({ type: 'int' })
  sms_count: number;

  @Column({ type: 'bigint' })
  cost_paisa: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'entered_by_user_id' })
  entered_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  entered_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deleted_by_user_id' })
  deleted_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  deleted_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  delete_reason: string | null;
}
