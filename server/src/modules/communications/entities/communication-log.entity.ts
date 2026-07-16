import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { User } from '../../users/entities/user.entity';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@beton-boi/shared';

/**
 * Audit trail for every message sent through the system.
 *
 * Records all outbound communications (SMS, WhatsApp, email, phone call)
 * sent to guardians, students, or staff. Used for delivery tracking,
 * debugging failed sends, and compliance. Each log captures the message
 * content, recipient, delivery status, and who triggered it.
 *
 * Relations:
 * - @ManyToOne → Student (optional): the student this message is about
 * - @ManyToOne → Guardian (optional): the guardian who received it
 * - @ManyToOne → User (sent_by): the staff member who sent it (or null for automated)
 */
@Entity('communication_logs')
export class CommunicationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: CommunicationMedium })
  medium: CommunicationMedium;

  @Column({ type: 'varchar', length: 255 })
  recipient_address: string;

  @Column({ type: 'varchar', length: 100 })
  recipient_name: string;

  @Column({ type: 'text' })
  message_body: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subject: string | null;

  @Column({ type: 'enum', enum: CommunicationStatus, default: CommunicationStatus.QUEUED })
  status: CommunicationStatus;

  @Column({ type: 'enum', enum: CommunicationTrigger, default: CommunicationTrigger.MANUAL })
  trigger: CommunicationTrigger;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'student_id' })
  student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @ManyToOne(() => Guardian, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'guardian_id' })
  guardian: Guardian | null;

  @Column({ type: 'uuid', nullable: true })
  guardian_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sent_by_user_id' })
  sent_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  sent_by_user_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_message_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}