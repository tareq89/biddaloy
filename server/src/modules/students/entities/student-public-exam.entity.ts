import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PublicExamType } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { Student } from './student.entity';

/**
 * [39.1.2] A board/public exam result recorded for a student (D21). Soft-deleted.
 *
 * Relations:
 * - @ManyToOne → School: the tenant
 * - @ManyToOne → Student: whose result this is
 */
@Entity('student_public_exams')
@Index('IDX_student_public_exams_tenant_student', ['tenant_id', 'student_id'])
export class StudentPublicExam {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'enum', enum: PublicExamType })
  exam_type: PublicExamType;

  @Column({ type: 'text' })
  board: string;

  @Column({ type: 'varchar', length: 50 })
  roll_no: string;

  @Column({ type: 'varchar', length: 50 })
  registration_no: string;

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  gpa: string | null;

  @Column({ type: 'int' })
  passing_year: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
