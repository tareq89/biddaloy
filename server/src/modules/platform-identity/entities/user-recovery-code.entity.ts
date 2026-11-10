import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] One hashed (sha-256 hex) one-time recovery code. */
@Entity('user_recovery_codes')
@Index('IDX_user_recovery_codes_user_id', ['user_id'])
@Check('CHK_user_recovery_codes_hash_len', 'length("code_hash") = 64')
export class UserRecoveryCode {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_recovery_codes' })
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_recovery_codes_user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 64 })
  code_hash: string;

  @Column({ type: 'timestamptz', nullable: true })
  used_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
