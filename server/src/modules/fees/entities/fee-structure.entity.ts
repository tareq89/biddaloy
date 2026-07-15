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
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { FeeType, FeeApplicability } from '@beton-boi/shared';

@Entity('fee_structures')
@Index(['class_id', 'fee_type', 'month'])
export class FeeStructure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: FeeType })
  fee_type: FeeType;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: FeeApplicability, default: FeeApplicability.ALL })
  applicability: FeeApplicability;

  @ManyToOne(() => Class, { nullable: false })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

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

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'boolean', default: true })
  is_recurring: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}