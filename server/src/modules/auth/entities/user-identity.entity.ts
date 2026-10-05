import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * A social sign-in (Google / Facebook) linked to a user [13.1.2].
 * Platform-level like `User`: no `tenant_id`. `provider` is a plain string
 * until the shared provider enum lands (#1612).
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
  provider: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
