import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { PaymentSubmission } from './payment-submission.entity';

/** [3.x] Proof image of a PROOF submission. Only a hash of the upload name is kept, never the raw name. */
@Entity('payment_submission_files')
@Index(['tenant_id'])
@Index(['submission_id'])
export class PaymentSubmissionFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PaymentSubmission, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission: PaymentSubmission;

  @Column({ type: 'uuid' })
  submission_id: string;

  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  @Column({ type: 'int' })
  size_bytes: number;

  @Column({ type: 'varchar', length: 64 })
  original_name_hash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
