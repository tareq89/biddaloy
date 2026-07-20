import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * A school / tenant in the multi-tenant system.
 *
 * Each school operates independently with its own classes, students,
 * fee structures, and users. A single user can belong to multiple
 * schools with different roles (e.g., Teacher in School A, Guardian in School B).
 *
 * Relations:
 * - Referenced-by → UserTenant: membership linking users to this school
 * - Referenced-by → AcademicYear: academic years are school-scoped
 * - Referenced-by → Class: classes are school-scoped
 * - Referenced-by → Teacher: teachers are school-scoped
 * - Referenced-by → Student: students are school-scoped
 */
@Entity('schools')
@Index(['slug'], { unique: true })
@Index(['domain'], { unique: true, where: 'domain IS NOT NULL' })
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  domain: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}