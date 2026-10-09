import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Program } from './program.entity';
import { Student } from '../../students/entities/student.entity';
import { ProgramEnrollmentStatus } from '@biddaloy/shared';

/**
 * [34.1.3] A student's enrollment in a `Program`. Only one ACTIVE
 * enrollment per (program, student) at a time (D19) — enforced by a
 * partial unique index in the migration
 * (`IDX_program_enrollments_program_student_active`). Enrolment and
 * recording endpoints come in 34.2.1 — this ticket only needs the entity
 * so `ProgramsService.remove` can count enrolments for the D23 delete
 * rule.
 *
 * Relations:
 * - @ManyToOne → School: tenant the enrollment belongs to
 * - @ManyToOne → Program: the program the student is enrolled in
 * - @ManyToOne → Student: the enrolled student
 * - Referenced-by → MilestoneAchievement: achievements recorded against
 *   this enrollment
 */
@Entity('program_enrollments')
@Index(['tenant_id', 'program_id'])
@Index(['tenant_id', 'student_id'])
export class ProgramEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Program, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'program_id' })
  program: Program;

  @Column({ type: 'uuid' })
  program_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'date' })
  started_on: string;

  @Column({ type: 'date', nullable: true })
  ended_on: string | null;

  @Column({
    type: 'enum',
    enum: ProgramEnrollmentStatus,
    default: ProgramEnrollmentStatus.ACTIVE,
  })
  status: ProgramEnrollmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
