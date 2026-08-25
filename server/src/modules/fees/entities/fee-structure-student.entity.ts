import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
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

  @ManyToOne(() => FeeStructure, (structure) => structure.selected_students, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fee_structure_id' })
  // Optional on the type because the only path that serializes these pivot
  // rows — `FeeStructureService.findOne` — loads `student` but never joins
  // back to the parent it already has. Marking it required would put a
  // circular `fee_structure` on the generated client type that no response
  // ever actually carries.
  fee_structure?: FeeStructure;

  @Column({ type: 'uuid' })
  fee_structure_id: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;
}
