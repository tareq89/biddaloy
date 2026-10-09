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

export type SurveyStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type SurveyRespondent = 'STUDENTS' | 'GUARDIANS' | 'BOTH';

/** [28.1.2] A teacher-evaluation survey. `min_responses` gates result visibility. */
@Entity('surveys')
@Index('IDX_surveys_tenant_status', ['tenant_id', 'status'])
export class Survey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: SurveyStatus;

  @Column({ type: 'boolean', default: true })
  anonymous: boolean;

  @Column({ type: 'varchar', length: 20 })
  respondent: SurveyRespondent;

  @Column({ type: 'timestamptz', nullable: true })
  opens_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closes_at: Date | null;

  @Column({ type: 'integer', default: 5 })
  min_responses: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
