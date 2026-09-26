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

/** A present/permanent address row for one staff member (23.3). */
@Entity('staff_addresses')
@Index(['tenant_id'])
@Index(['staff_user_id'])
export class StaffAddress {
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

  @Column({ type: 'enum', enum: ['PRESENT', 'PERMANENT'], enumName: 'staff_addresses_type_enum' })
  type: 'PRESENT' | 'PERMANENT';

  @Column({ type: 'varchar', length: 200, nullable: true })
  village_street: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  post_office: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  upazila: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
