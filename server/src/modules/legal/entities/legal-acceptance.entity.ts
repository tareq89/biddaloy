import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * [59.1.02] One legal document version a person accepted in one school. Append-only: a version
 * bump (see `LEGAL_DOCS` in shared) adds a row, never edits one.
 */
@Entity('legal_acceptances')
@Check('CHK_legal_acceptances_document', `"document" IN ('terms', 'privacy', 'dpa', 'sla')`)
@Index(['user_id', 'tenant_id'])
@Unique('UQ_legal_acceptances_user_tenant_doc_version', [
  'user_id',
  'tenant_id',
  'document',
  'version',
])
export class LegalAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** A `LegalDocument` value; the DB CHECK pins the allowed list. */
  @Column({ type: 'varchar', length: 16 })
  document: string;

  @Column({ type: 'varchar', length: 16 })
  version: string;

  @CreateDateColumn({ type: 'timestamptz' })
  accepted_at: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;
}
