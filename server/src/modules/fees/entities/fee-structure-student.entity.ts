import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FeeStructure } from './fee-structure.entity';
import { Student } from '../../students/entities/student.entity';

/**
 * Pivot linking a SELECTED-applicability FeeStructure to specific students.
 *
 * When a fee structure has applicability=SELECTED, this table records
 * exactly which students it applies to (instead of the default ALL).
 *
 * Relations:
 * - @ManyToOne → FeeStructure: the selected-student fee definition
 * - @ManyToOne → Student: the student this fee applies to
 */
@Entity('fee_structure_students')
@Index(['fee_structure_id', 'student_id'], { unique: true })
export class FeeStructureStudent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => FeeStructure, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fee_structure_id' })
  fee_structure: FeeStructure;

  @Column({ type: 'uuid' })
  fee_structure_id: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;
}