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

/**
 * A revocable token authorizing an ICS feed subscription for one user
 * (17.x) — the feed URL embeds `token_hash`'s plaintext, never the hash
 * itself. Only one active token per `(tenant_id, user_id)` (D13):
 * requesting a new feed link revokes any prior one, so a leaked URL can be
 * cut off by generating a new one rather than a separate revoke step.
 */
@Entity('calendar_feed_tokens')
@Index(['tenant_id', 'user_id'], { unique: true, where: '"revoked_at" IS NULL' })
export class CalendarFeedToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  /** SHA-256 hex digest of the token's plaintext. */
  @Column({ type: 'char', length: 64, unique: true })
  token_hash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;
}
