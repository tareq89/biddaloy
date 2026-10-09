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
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/** An education row for one staff member (23.4). */
@Entity('staff_education')
@Index(['tenant_id'])
@Index(['staff_user_id'])
export class StaffEducation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_user_id' })
  staff_user: User;

  @Column({ type: 'uuid' })
  staff_user_id: string;

  @Column({ type: 'varchar', length: 200 })
  degree: string;

  @Column({ type: 'varchar', length: 200 })
  institution: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  board_university: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  result: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  passing_year: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
