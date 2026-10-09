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
import { HomeworkAssignment } from './homework-assignment.entity';
import { Student } from '../../students/entities/student.entity';
import { School } from '../../schools/entities/school.entity';
import { HomeworkSubmissionStatus } from '@biddaloy/shared';

/**
 * One student's submission against a `HomeworkAssignment` (D19) — always
 * exactly one row per (assignment, student), created implicitly at
 * NOT_SUBMITTED before the student acts.
 *
 * Relations:
 * - @ManyToOne → HomeworkAssignment: the assignment this submission answers
 * - @ManyToOne → Student: the submitting student
 * - @ManyToOne → School: the tenant this submission belongs to
 */
@Entity('homework_submissions')
@Index(['tenant_id'])
@Index('IDX_homework_submissions_assignment_student', ['assignment_id', 'student_id'], {
  unique: true,
})
export class HomeworkSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => HomeworkAssignment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: HomeworkAssignment;

  @Column({ type: 'uuid' })
  assignment_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({
    type: 'enum',
    enum: HomeworkSubmissionStatus,
    default: HomeworkSubmissionStatus.NOT_SUBMITTED,
  })
  status: HomeworkSubmissionStatus;

  @Column({ type: 'int', nullable: true })
  marks: number | null;

  @Column({ type: 'jsonb', default: [] })
  attachments: unknown[];

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
