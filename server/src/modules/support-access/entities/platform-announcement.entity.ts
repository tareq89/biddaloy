import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 99] A platform-wide announcement record. Platform data, not school data. */
@Entity('platform_announcements')
@Unique('UQ_platform_announcements_idempotency_key', ['idempotency_key'])
export class PlatformAnnouncement {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_platform_announcements' })
  id: string;

  @Column({ type: 'uuid' })
  created_by: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb' })
  status_filter: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  channels: unknown;

  @Column({ type: 'int', default: 0 })
  recipient_count: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  idempotency_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'FK_platform_announcements_created_by',
  })
  created_by_user: User;
}
