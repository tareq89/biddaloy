import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToMany,
  JoinColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Student } from './student.entity';
import { CommunicationMedium } from '@beton-boi/shared';

@Entity('guardians')
@Index(['phone'])
@Index(['email'])
export class Guardian {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  @Column({ type: 'varchar', length: 50 })
  relationship: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  alternate_phone: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation: string | null;

  @Column({ type: 'enum', enum: CommunicationMedium, default: CommunicationMedium.SMS })
  preferred_communication: CommunicationMedium;

  @Column({ type: 'boolean', default: true })
  is_primary_contact: boolean;

  @ManyToMany(() => Student, (student) => student.guardians)
  students: Student[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}