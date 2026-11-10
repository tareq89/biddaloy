import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] A platform owner. A lock is `users.status = 'SUSPENDED'` (D24); this row records who/when. */
@Entity('platform_admins')
export class PlatformAdmin {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_platform_admins' })
  user_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_platform_admins_user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: true })
  locked_by: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'locked_by', foreignKeyConstraintName: 'FK_platform_admins_locked_by' })
  locked_by_user: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
