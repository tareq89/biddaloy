import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, OneToMany } from "typeorm";
import { UserTenant } from "../../auth/entities/user-tenant.entity";
import { UserStatus } from "@beton-boi/shared";

/**
 * Central user account for the system.
 *
 * Roles are now stored per-tenant in the `user_tenants` junction table,
 * enabling multi-tenant / multi-role support (a user can be a Teacher in
 * School A and a Guardian in School B simultaneously).
 *
 * Staff accounts (teachers, admins) have password_hash set.
 * Guardian/student accounts may have null password_hash if they don't log in
 * (created via bulk Excel upload).
 *
 * Relations:
 * - @OneToMany → UserTenant: all memberships across tenants
 * - @OneToOne → Teacher (teacher_profile): linked when role=TEACHER
 * - @OneToOne → Guardian (guardian_profile): linked when role=PARENT
 * - @OneToOne → Student (student_profile): linked when role=STUDENT
 * - Referenced-by → Payment (received_by): the user who recorded a payment
 * - Referenced-by → CommunicationLog (sent_by): who sent the message
 * - Referenced-by → ReminderBatch (initiated_by): who triggered the batch
 * - Referenced-by → AuditLog (performed_by): who performed the action
 * - Referenced-by → Invoice (issued_by): who issued the invoice
 */
@Entity("users")
@Index(["email"])
@Index(["phone"])
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @OneToMany(() => UserTenant, (ut) => ut.user)
  user_tenants: UserTenant[];

  @Column({ type: "varchar", length: 100, unique: true, nullable: true })
  email: string | null;

  @Column({ type: "varchar", length: 20, unique: true, nullable: true })
  phone: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  password_hash: string | null;

  @Column({ type: "enum", enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: "varchar", length: 100 })
  full_name: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  profile_picture_url: string | null;

  @Column({ type: "jsonb", nullable: true })
  preferences: Record<string, any> | null;

  @Column({ type: "timestamptz", nullable: true })
  last_login_at: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @DeleteDateColumn({ type: "timestamptz", nullable: true })
  deleted_at: Date | null;
}
