import { Entity, PrimaryColumn, Column, CreateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] TOTP secret (encrypted) for a user; `last_step` blocks code replay. */
@Entity('user_mfa')
export class UserMfa {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_user_mfa' })
  user_id: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_mfa_user_id' })
  user: User;

  @Column({ type: 'text' })
  secret_enc: string;

  @Column({ type: 'timestamptz', nullable: true })
  confirmed_at: Date | null;

  @Column({ type: 'bigint', nullable: true })
  last_step: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
