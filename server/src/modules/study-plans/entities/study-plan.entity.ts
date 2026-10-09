import {
  Check,
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
import type { StudyPlanExamMarker, StudyPlanLesson } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { AcademicTerm } from '../../calendar/entities/academic-term.entity';
import { Teacher } from '../../academics/entities/teacher.entity';

/**
 * [66.1.03/#2001] An ordered lesson plan for one section + subject, for the
 * whole year (`academic_term_id` NULL) or one term (D14).
 *
 * One live plan per (tenant, section, subject, term) is enforced by
 * `UQ_study_plans_scope` in `1791500000000-StudyPlans.ts`, with
 * `NULLS NOT DISTINCT` so a NULL term still collides. TypeORM's `@Index`
 * cannot express that, so it is not declared here (same as
 * `academics/entities/class.entity.ts`); the migration is the source of truth.
 *
 * Relations:
 * - @ManyToOne → School, ClassSection, Subject, AcademicYear (CASCADE)
 * - @ManyToOne → AcademicTerm (nullable, CASCADE)
 * - @ManyToOne → Teacher (nullable, SET NULL): owner override
 */
@Entity('study_plans')
@Index('IDX_study_plans_tenant_year', ['tenant_id', 'academic_year_id'])
@Check(
  'CHK_study_plans_json',
  `jsonb_typeof("lessons") = 'array' AND jsonb_typeof("exam_markers") = 'array'`,
)
export class StudyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => AcademicTerm, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_term_id' })
  academic_term: AcademicTerm | null;

  @Column({ type: 'uuid', nullable: true })
  academic_term_id: string | null;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @ManyToOne(() => Teacher, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_override_teacher_id' })
  owner_override_teacher: Teacher | null;

  @Column({ type: 'uuid', nullable: true })
  owner_override_teacher_id: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lessons: StudyPlanLesson[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  exam_markers: StudyPlanExamMarker[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
