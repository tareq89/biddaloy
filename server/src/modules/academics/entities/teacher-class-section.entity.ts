import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Teacher } from '../../academics/entities/teacher.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { School } from '../../schools/entities/school.entity';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { Subject } from './subject.entity';

/**
 * Junction table linking a Teacher to the ClassSections they are assigned
 * to. Each row has an `assignment_type`:
 * - CLASS_TEACHER: at most one per section (`UQ_tcs_section_class_teacher`)
 * - ASSISTANT_CLASS_TEACHER: any number per section
 * - SUBJECT_TEACHER: requires `subject_id` (`CK_tcs_subject_matches_type`)
 * A teacher holds at most one homeroom (class/assistant) row per section
 * (`UQ_tcs_teacher_section_homeroom`).
 *
 * A BEFORE INSERT trigger (`tcs_default_assignment_type`) infers the type
 * when an insert omits it: `subject_id` set -> SUBJECT_TEACHER, else
 * CLASS_TEACHER. Those partial indexes and the check are raw SQL in the
 * `TeacherAssignmentType` migration; `@Index` cannot express them.
 *
 * Relations:
 * - @ManyToOne -> Teacher: the teacher
 * - @ManyToOne -> ClassSection: the section they teach
 * - @ManyToOne -> School: the tenant this assignment belongs to
 * - @ManyToOne -> Subject: the subject taught, for SUBJECT_TEACHER rows
 */
@Entity('teacher_class_sections')
@Index('IDX_tcs_teacher_section_subject', ['teacher_id', 'section_id', 'subject_id'], {
  unique: true,
})
export class TeacherClassSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Teacher, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher;

  @Column({ type: 'uuid' })
  teacher_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Subject, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @Column({
    type: 'enum',
    enum: TeacherAssignmentType,
    enumName: 'teacher_assignment_type',
  })
  assignment_type: TeacherAssignmentType;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
