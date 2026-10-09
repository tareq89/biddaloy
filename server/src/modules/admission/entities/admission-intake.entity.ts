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
import { School } from '../../schools/entities/school.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AdmissionDocumentType } from '@biddaloy/shared';

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
 * - @ManyToOne → ClassSection: the section applicants are admitted into
 * - Referenced-by → AdmissionApplicant: applicants against this intake
 */
@Entity('admission_intakes')
@Index(['tenant_id', 'class_section_id'])
export class AdmissionIntake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_section_id' })
  class_section: ClassSection;

  @Column({ type: 'uuid' })
  class_section_id: string;

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
