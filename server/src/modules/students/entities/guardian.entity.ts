import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToMany,
  JoinColumn,
  OneToOne,
  Index,
  ManyToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Student } from './student.entity';
import { School } from '../../schools/entities/school.entity';
import { CommunicationMedium } from '@beton-boi/shared';

/**
 * Parent or guardian responsible for a student.
 *
 * A guardian can have multiple children enrolled (siblings), and a student
 * can have multiple guardians (father + mother). Guardians may optionally
 * have a User account for self-service login and online fee payment.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this guardian belongs to
 * - @OneToOne → User (optional): login account for guardian self-service
 * - @ManyToMany → Student (via student_guardians): linked children
 * - Referenced-by → CommunicationLog: messages sent to this guardian
 */
@Entity('guardians')
@Index(['phone'])
@Index(['email'])
export class Guardian {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  @Column({ type: 'varchar', length: 50 })
  relationship: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  alternate_phone: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation: string | null;

  @Column({ type: 'enum', enum: CommunicationMedium, default: CommunicationMedium.SMS })
  preferred_communication: CommunicationMedium;

  @Column({ type: 'boolean', default: true })
  is_primary_contact: boolean;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToMany(() => Student, (student) => student.guardians)
  students: Student[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}