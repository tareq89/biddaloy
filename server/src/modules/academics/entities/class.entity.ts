import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AcademicYear } from './academic-year.entity';
import { ClassSection } from './class-section.entity';

/**
 * A grade/standard within an academic year (e.g., "Class 10", "Grade 5").
 *
 * Classes are unique per academic year (same name can't exist twice in one year).
 * Each class has multiple sections (e.g., "A", "B").
 *
 * Relations:
 * - @ManyToOne → AcademicYear: the year this class belongs to
 * - @OneToMany → ClassSection: sections under this class
 * - Referenced-by → FeeStructure: fees are configured per class
 * - Referenced-by → Student: students are enrolled in a class via section
 */
@Entity('classes')
@Index(['name', 'academic_year_id'], { unique: true })
export class Class {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'int', nullable: true })
  numeric_grade: number | null;

  @ManyToOne(() => AcademicYear, { nullable: false })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @OneToMany(() => ClassSection, (section) => section.class)
  sections: ClassSection[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}