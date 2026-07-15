import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
  OneToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Guardian } from './guardian.entity';
import { CommunicationMedium, EnrollmentStatus } from '@beton-boi/shared';

@Entity('students')
@Index(['registration_number'], { unique: true })
@Index(['class_section_id', 'roll_number'], { unique: true })
export class Student {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  registration_number: string;

  @Column({ type: 'int' })
  roll_number: number;

  @ManyToOne(() => ClassSection, { nullable: false })
  @JoinColumn({ name: 'class_section_id' })
  class_section: ClassSection;

  @Column({ type: 'uuid' })
  class_section_id: string;

  @Column({ type: 'date' })
  date_of_birth: Date;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: string | null;

  @Column({ type: 'text', nullable: true })
  home_address: string | null;

  @Column({ type: 'enum', enum: CommunicationMedium, default: CommunicationMedium.SMS })
  preferred_communication: CommunicationMedium;

  @ManyToMany(() => Guardian, (guardian) => guardian.students, { cascade: true })
  @JoinTable({
    name: 'student_guardians',
    joinColumn: { name: 'student_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'guardian_id', referencedColumnName: 'id' },
  })
  guardians: Guardian[];

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ACTIVE })
  enrollment_status: EnrollmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}