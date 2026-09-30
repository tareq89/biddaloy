import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from './student.entity';

/**
 * [39.1.2] A staff note on a student (D29). Soft-deleted.
 *
 * Relations:
 * - @ManyToOne → School: the tenant
 * - @ManyToOne → Student: who the note is about
 */
@Entity('student_notes')
@Index('IDX_student_notes_tenant_student', ['tenant_id', 'student_id'])
export class StudentNote {
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

  @Column({ type: 'uuid' })
  author_user_id: string;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
