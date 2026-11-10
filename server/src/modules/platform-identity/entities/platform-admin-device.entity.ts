import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] A device a platform owner has passed the device OTP on (hash only). */
@Entity('platform_admin_devices')
@Unique('UQ_platform_admin_devices_user_device', ['user_id', 'device_hash'])
export class PlatformAdminDevice {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_platform_admin_devices' })
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_platform_admin_devices_user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 64 })
  device_hash: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  last_seen_at: Date;
}
