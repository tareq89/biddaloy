import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import {
  ApplicationAddressee,
  ApplicationSource,
  ApplicationStatus,
  ApplicationType,
} from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Student } from '../../students/entities/student.entity';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [52.1.2] One application (আবেদনপত্র) of any of the 10 types. Matches migration
 * `Applications1791500000000` exactly.
 *
 * - Exactly one subject (student xor staff profile) — `CHK_applications_one_subject`.
 * - The applicant is a user, or (PAPER only) a bare `applicant_name` for a guardian
 *   with no login (D46) — `CHK_applications_applicant`.
 * - Serial is unique per school per year (D29).
 * - The three child tables reference `(tenant_id, id)` (`UQ_applications_tenant_id`) with
 *   composite FKs, so a child row can never name another school's application. Their
 *   `@JoinColumn`s stay single-column (TypeORM only joins on it; the DB holds the rule).
 * - No `@OneToMany` collections on purpose: saving an entity with a partly-loaded
 *   collection makes TypeORM NULL the missing children's FKs. Query the child
 *   tables (`application_events`, `_tags`, `_attachments`) by `application_id`.
 */
@Entity('applications')
@Index('IDX_applications_tenant_status_type', ['tenant_id', 'status', 'type'])
@Index('IDX_applications_tenant_subject_student', ['tenant_id', 'subject_student_id'])
@Index('IDX_applications_tenant_subject_staff', ['tenant_id', 'subject_staff_profile_id'])
@Index('IDX_applications_tenant_applicant', ['tenant_id', 'applicant_user_id'])
@Index('IDX_applications_tenant_addressee_user', ['tenant_id', 'addressee_user_id'], {
  where: '"addressee_user_id" IS NOT NULL',
})
@Unique('UQ_applications_tenant_serial', ['tenant_id', 'serial_year', 'serial_no'])
@Unique('UQ_applications_tenant_id', ['tenant_id', 'id'])
@Check(
  'CHK_applications_one_subject',
  `num_nonnulls("subject_student_id", "subject_staff_profile_id") = 1`,
)
@Check(
  'CHK_applications_applicant',
  `"applicant_user_id" IS NOT NULL OR ("source" = 'PAPER' AND "applicant_name" IS NOT NULL)`,
)
export class Application {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: ApplicationType })
  type: ApplicationType;

  @Column({ type: 'enum', enum: ApplicationStatus, default: ApplicationStatus.PENDING })
  status: ApplicationStatus;

  @Column({ type: 'enum', enum: ApplicationSource, default: ApplicationSource.APP })
  source: ApplicationSource;

  @Column({ type: 'int' })
  serial_year: number;

  @Column({ type: 'int' })
  serial_no: number;

  @ManyToOne(() => AcademicYear, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear | null;

  @Column({ type: 'uuid', nullable: true })
  academic_year_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'applicant_user_id' })
  applicant: User | null;

  @Column({ type: 'uuid', nullable: true })
  applicant_user_id: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  applicant_name: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'entered_by_user_id' })
  entered_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  entered_by_user_id: string | null;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_student_id' })
  subject_student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  subject_student_id: string | null;

  @ManyToOne(() => StaffProfile, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_staff_profile_id' })
  subject_staff_profile: StaffProfile | null;

  @Column({ type: 'uuid', nullable: true })
  subject_staff_profile_id: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

  @Column({ type: 'date', nullable: true })
  start_date: string | null;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'enum', enum: ApplicationAddressee, nullable: true })
  addressee: ApplicationAddressee | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'addressee_user_id' })
  addressee_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  addressee_user_id: string | null;

  @Column({ type: 'int', default: 0 })
  current_step: number;

  /** Letter snapshot written at submit; never updated. */
  @Column({ type: 'text' })
  letter_text: string;

  @Column({ type: 'varchar', length: 8 })
  letter_locale: string;

  @Column({ type: 'jsonb', nullable: true })
  granted: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  effect_result: Record<string, unknown> | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_user_id' })
  decided_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  decided_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
