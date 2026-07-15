import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { UserRole, UserStatus } from '@beton-boi/shared';

@Entity('users')
@Index(['email'])
@Index(['phone'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  profile_picture_url: string | null;

  @Column({ type: 'jsonb', nullable: true })
  preferences: Record<string, any> | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}