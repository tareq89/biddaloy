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

/** [100.1.02] The SMS balance the owner typed in from the provider's own dashboard. */
@Entity('sms_provider_balance_readings')
@Check('CHK_sms_provider_balance_readings_balance', '"sms_balance" >= 0')
export class SmsProviderBalanceReading {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  sms_balance: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'entered_by_user_id' })
  entered_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  entered_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
