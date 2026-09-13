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
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { School } from '../../schools/entities/school.entity';
import { FeeType } from '@biddaloy/shared';

/**
 * A fee price tag: name, fee type, amount, academic year, and an optional
 * class/section label. It does not decide who gets billed or when —
 * targeting and scheduling are owned by whatever generates StudentFee rows
 * from this structure.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this fee structure belongs to
 * - @ManyToOne → Class (optional): the class this fee is labelled with
 * - @ManyToOne → ClassSection (optional): specific section within the class
 * - @ManyToOne → AcademicYear: the academic year this fee is for
 * - Referenced-by → StudentFee: generated fee records reference this
 */
@Entity('fee_structures')
@Index('IDX_fee_structures_tenant_year_type', ['tenant_id', 'academic_year_id', 'fee_type'])
@Index(['tenant_id'])
export class FeeStructure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: FeeType })
  fee_type: FeeType;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @ManyToOne(() => Class, { nullable: true })
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  @Column({ type: 'uuid', nullable: true })
  class_id: string | null;

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

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
