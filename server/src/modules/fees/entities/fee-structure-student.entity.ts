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