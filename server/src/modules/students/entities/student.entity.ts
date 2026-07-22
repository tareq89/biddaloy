import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
  OneToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { School } from '../../schools/entities/school.entity';
import { Guardian } from './guardian.entity';
import { CommunicationMedium, EnrollmentStatus } from '@beton-boi/shared';

/**
 * A student enrolled in a class and section.
 *
 * Each student has a unique registration_number and a roll_number unique
 * within their class+section. Students can be linked to multiple guardians
 * (parents) and optionally have a User account for self-service login.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this student belongs to
 * - @OneToOne → User (optional): login account for student self-service
 * - @ManyToOne → ClassSection: the class + section the student belongs to
 * - @ManyToMany → Guardian (via student_guardians): parents/guardians
 * - Referenced-by → StudentFee: monthly fee records for this student
 * - Referenced-by → Payment: payments made by/for this student
 * - Referenced-by → Invoice: invoices issued to this student
 * - Referenced-by → FeeStructureStudent: selected-student fee applicability
 * - Referenced-by → CommunicationLog: messages sent regarding this student
 */
@Entity('students')
@Index(['class_section_id', 'roll_number'], { unique: true })
@Index(['tenant_id', 'registration_number'], { unique: true })
export class Student {
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
  registration_number: string;

  @Column({ type: 'int' })
  roll_number: number;

  @ManyToOne(() => ClassSection, { nullable: false })
  @JoinColumn({ name: 'class_section_id' })
  class_section: ClassSection;

  @Column({ type: 'uuid' })
  class_section_id: string;

  @Column({ type: 'date', nullable: true })
  date_of_birth: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: string | null;

  @Column({ type: 'text', nullable: true })
  home_address: string | null;

  @Column({ type: 'enum', enum: CommunicationMedium, default: CommunicationMedium.SMS })
  preferred_communication: CommunicationMedium;

  @ManyToMany(() => Guardian, (guardian) => guardian.students, { cascade: ['insert'] })
  @JoinTable({
    name: 'student_guardians',
    joinColumn: { name: 'student_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'guardian_id', referencedColumnName: 'id' },
  })
  guardians: Guardian[];

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ACTIVE })
  enrollment_status: EnrollmentStatus;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}