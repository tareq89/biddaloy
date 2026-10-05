import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { SocialProvider } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';

/**
 * A social sign-in (Google / Facebook) linked to a user [13.1.2].
 * Platform-level like `User`: no `tenant_id`. The column stays varchar;
 * `SocialProvider` (shared) types it.
 */
@Entity('user_identities')
// Names match migration 1791400000000, so `migration:generate` stays clean.
@Unique('UQ_user_identities_provider_subject', ['provider', 'subject'])
@Unique('UQ_user_identities_user_provider', ['user_id', 'provider'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_identities' })
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_identities_user' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: SocialProvider;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
