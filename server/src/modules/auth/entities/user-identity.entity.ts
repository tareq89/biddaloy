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
@Unique(['provider', 'subject'])
@Unique(['user_id', 'provider'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
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
