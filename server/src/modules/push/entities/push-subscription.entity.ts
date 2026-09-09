import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * One browser/device's Web Push subscription for a user. A user can hold
 * many rows — one per device they've enabled notifications on — since the
 * browser-issued `endpoint` URL (globally unique) identifies a single
 * device+browser combination.
 *
 * `p256dh`/`auth` are the subscription's public key and auth secret,
 * handed back verbatim to `web-push` when sending. `failure_count` lets a
 * sender prune subscriptions that keep failing (e.g. the user revoked
 * permission) without needing to parse push-service error codes here.
 *
 * Relations:
 * - @ManyToOne → User: the subscriber this device belongs to.
 * - @ManyToOne → School: the tenant this row belongs to. Stored directly
 *   rather than derived via `user` so the row stays unambiguously scoped
 *   even if the user's tenant membership changes later — same rationale
 *   as `SmsCreditLedger.tenant_id`.
 */
@Entity('push_subscriptions')
@Index(['user_id'])
@Unique('UQ_push_subscriptions_endpoint', ['endpoint'])
export class PushSubscription {
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

  @Column({ type: 'text' })
  endpoint: string;

  @Column({ type: 'text' })
  p256dh: string;

  @Column({ type: 'text' })
  auth: string;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_used_at: Date | null;

  @Column({ type: 'int', default: 0 })
  failure_count: number;
}
