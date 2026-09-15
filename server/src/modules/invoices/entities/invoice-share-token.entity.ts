import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [16.5.6, #666] A public, tenant-less share link onto one invoice's
 * receipt view (`GET /public/invoices/:token`). The raw token handed to
 * the caller (32 random bytes, base64url-encoded) is never persisted —
 * only its SHA-256 hex digest (`token_hash`, 64 hex chars) is stored, so
 * a leaked database dump can never be turned back into a working link.
 *
 * `tenant_id` is stored directly (not derived only via `invoice`) so the
 * public route — which never sees an `X-Tenant-ID` header — can resolve
 * the owning tenant from the token alone, the same "the secret carries
 * its own scope" shape `refresh_tokens` and invitation tokens already use.
 *
 * `revoked_at` set (non-null) makes the token permanently invalid; there
 * is no "un-revoke". `last_viewed_at`/`view_count` are bumped on every
 * successful `validatePublicToken` call, for basic usage visibility —
 * they are not a security control.
 */
@Entity('invoice_share_tokens')
export class InvoiceShareToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Invoice, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'uuid' })
  invoice_id: string;

  @Column({ type: 'char', length: 64, unique: true })
  token_hash: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_viewed_at: Date | null;

  @Column({ type: 'int', default: 0 })
  view_count: number;
}
