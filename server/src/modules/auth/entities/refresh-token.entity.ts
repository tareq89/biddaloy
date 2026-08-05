import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * One refresh token in a rotation chain ("family"). Only a SHA-256 hash of
 * the token's random secret half is ever stored — see refresh-token.service.ts
 * for the selector/validator split that lets a token be looked up by id
 * without a full-table hash scan, the same reasoning that led the Swagger
 * docs Basic Auth (docs-auth.ts) to avoid hashing there: these are opaque
 * 256-bit random secrets, not user-chosen passwords, so a fast hash is the
 * right tool here rather than the anti-pattern CodeQL flags for passwords.
 *
 * `family_id` ties every token descended from one login together: reuse of
 * an already-rotated token revokes the whole family, not just that one row,
 * since reuse means the family's chain of custody is broken and every
 * token in it must be treated as potentially compromised.
 */
@Entity('refresh_tokens')
@Index(['family_id'])
@Index(['user_id'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  family_id: string;

  @Column({ type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  replaced_by_id: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
