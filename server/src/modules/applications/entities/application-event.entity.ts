import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApplicationEventKind } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { Application } from './application.entity';

/**
 * [52.1.2] Append-only timeline of an application (submitted, step approved,
 * comment, ...). No `updated_at`, no soft delete: events are never edited.
 */
@Entity('application_events')
@Index('IDX_application_events_tenant_application', ['tenant_id', 'application_id'])
export class ApplicationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Application, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ type: 'uuid' })
  application_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User;

  @Column({ type: 'uuid' })
  actor_user_id: string;

  @Column({ type: 'enum', enum: ApplicationEventKind })
  kind: ApplicationEventKind;

  @Column({ type: 'int', nullable: true })
  step: number | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
