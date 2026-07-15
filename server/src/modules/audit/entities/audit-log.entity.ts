import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AuditAction } from '@beton-boi/shared';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'varchar', length: 100 })
  entity_type: string;

  @Column({ type: 'uuid', nullable: true })
  entity_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performed_by_user_id' })
  performed_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  performed_by_user_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  old_values: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  new_values: Record<string, any> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}