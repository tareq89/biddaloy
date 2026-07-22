import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Teacher } from '../../academics/entities/teacher.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';

/**
 * Junction table linking a Teacher to the ClassSections they are assigned to.
 *
 * A teacher can be assigned to multiple sections, and a section can have
 * multiple teachers (e.g., subject teachers).
 *
 * Relations:
 * - @ManyToOne → Teacher: the teacher
 * - @ManyToOne → ClassSection: the section they teach
 */
@Entity('teacher_class_sections')
@Unique(['teacher_id', 'section_id'])
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

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}