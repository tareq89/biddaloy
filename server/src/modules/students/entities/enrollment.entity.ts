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
import { Student } from './student.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { EnrollmentStatus } from '@beton-boi/shared';

/**
 * Tracks a student's enrollment in a class and section for a specific academic year.
 *
 * Provides enrollment history — a student can be enrolled in different classes
 * across different academic years. The current enrollment is determined by the
 * most recent ACTIVE record.
 *
 * Relations:
 * - @ManyToOne → Student: the enrolled student
 * - @ManyToOne → Class: the class they're enrolled in
 * - @ManyToOne → ClassSection (optional): specific section within the class
 * - @ManyToOne → AcademicYear: the academic year for this enrollment
 */
@Entity('enrollments')
@Index(['student_id'])
@Index(['academic_year_id'])
@Index(['student_id', 'academic_year_id'], { unique: true, where: '"enrollment_status" = \'ACTIVE\'' })
export class Enrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Class, { nullable: false })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => ClassSection, { nullable: true })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection | null;

  @Column({ type: 'uuid', nullable: true })
  section_id: string | null;

  @ManyToOne(() => AcademicYear, { nullable: false })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ACTIVE })
  enrollment_status: EnrollmentStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  enrolled_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}