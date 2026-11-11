import { Entity, PrimaryColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] Platform-level key/value setting (e.g. the two-owner approvals switch). */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ type: 'varchar', length: 60, primaryKeyConstraintName: 'PK_platform_settings' })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by', foreignKeyConstraintName: 'FK_platform_settings_updated_by' })
  updated_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
