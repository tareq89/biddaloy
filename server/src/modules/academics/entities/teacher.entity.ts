import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TeacherDesignation } from '@beton-boi/shared';

/**
 * Staff profile extending the base User account.
 *
 * Every teacher is first a User (with login credentials), then has a Teacher
 * profile with school-specific attributes. A teacher can hold multiple
 * designations (e.g., both CLASS_TEACHER and SUBJECT_TEACHER).
 *
 * Relations:
 * - @OneToOne → User (user): the login account (CASCADE delete — removing user removes teacher)
 * - @ManyToMany → ClassSection (via teacher_class_sections): sections the teacher is assigned to
 */
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