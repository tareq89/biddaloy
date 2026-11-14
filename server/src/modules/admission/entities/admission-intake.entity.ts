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
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Class } from '../../academics/entities/class.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import type {
  AdmissionDocumentType,
  AdmissionTemplateKey,
  AdmissionPayMethod,
} from '@biddaloy/shared';

/**
 * [27.1] An admission window opened for one class section — seat count,
 * open/close dates, and the document types applicants must upload.
 *
 * `status` (OPEN/CLOSED) is deliberately NOT a persisted column: it is
 * fully derived from `open_date`/`close_date` against "now", so a naive
 * stored column would need a cron/trigger to stay correct at midnight.
 * The service layer (a later ticket) computes it on read.
 *
 * Relations:
 * - @ManyToOne → School: tenant the intake belongs to
 * - @ManyToOne → ClassSection: the section applicants are admitted into (null for pipeline rounds)
 * - @ManyToOne → Class / AcademicYear: what the round admits into (Epic 71)
 * - Referenced-by → AdmissionApplicant: applicants against this intake
 */
@Entity('admission_intakes')
@Index(['tenant_id', 'class_section_id'])
@Check('CHK_admission_intakes_fee_amount', '"fee_amount_paisa" IS NULL OR "fee_amount_paisa" >= 0')
export class AdmissionIntake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** Null for pipeline rounds ([Epic 71] admit picks the section); old rounds always have one. */
  @ManyToOne(() => ClassSection, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_section_id' })
  class_section: ClassSection | null;

  @Column({ type: 'uuid', nullable: true })
  class_section_id: string | null;

  /** [Epic 71] Class the round admits into. Nullable until the service ticket sets it on create. */
  @ManyToOne(() => Class, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  @Column({ type: 'uuid', nullable: true })
  class_id: string | null;

  /** [Epic 71] Academic year of the round (via the class). Nullable like `class_id`. */
  @ManyToOne(() => AcademicYear, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear | null;

  @Column({ type: 'uuid', nullable: true })
  academic_year_id: string | null;

  /** [Epic 71 D20] Template the round was made from. Old rounds are `APPLY_ONLY`. */
  @Column({ type: 'varchar', length: 20, default: 'APPLY_ONLY' })
  template_key: AdmissionTemplateKey;

  @Column({ type: 'varchar', length: 20, nullable: true })
  roll_prefix: string | null;

  @Column({ type: 'int', default: 0 })
  roll_counter: number;

  /** Whole paisa (Rule 26); null = no fee. */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: unknown) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  fee_amount_paisa: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fee_pay_methods: AdmissionPayMethod[];

  /** Ticked form-field catalogue keys. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  form_fields: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  publish_channels: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tie_break: string[];

  @Column({ type: 'boolean', default: false })
  show_names_publicly: boolean;

  @Column({ type: 'boolean', default: false })
  widget_always_show: boolean;

  @Column({ type: 'boolean', default: false })
  auto_activate_lists: boolean;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'int' })
  seat_count: number;

  @Column({ type: 'date' })
  open_date: string;

  @Column({ type: 'date' })
  close_date: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  required_document_types: AdmissionDocumentType[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
