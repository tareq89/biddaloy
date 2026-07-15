import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  ManyToMany,
  JoinTable,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TeacherDesignation } from '@beton-boi/shared';

@Entity('teachers')
export class Teacher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  employee_id: string;

  @Column({ type: 'enum', enum: TeacherDesignation, array: true, default: [] })
  designations: TeacherDesignation[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  subject_specialization: string | null;

  @Column({ type: 'date', nullable: true })
  joining_date: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}