import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StaffDocumentType } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [23.6] One uploaded identity/HR document for a staff member — NID, birth
 * certificate, photo, or a general document. Keyed by `tenant_id` +
 * `staff_user_id` (D1's pattern, same as `StaffHrRecord`), NOT a FK to
 * `StaffHrRecord` — a staff member can have documents on file before their
 * HR record exists.
 *
 * `storage_key` points at the object in `StorageService` (see
 * `staff-document.service.ts`'s `upload()`, cloned from
 * `HomeworkSubmissionService.upload()`).
 */
@Entity('staff_documents')
@Index(['tenant_id'])
@Index('UQ_staff_documents_tenant_staff_type', ['tenant_id', 'staff_user_id', 'document_type'], {
  unique: true,
})
export class StaffDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_user_id' })
  staff_user: User;

  @Column({ type: 'uuid' })
  staff_user_id: string;

  @Column({ type: 'enum', enum: StaffDocumentType })
  document_type: StaffDocumentType;

  @Column({ type: 'varchar', length: 500 })
  storage_key: string;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  // SET NULL, not CASCADE: deleting the admin who uploaded a document must
  // never cascade-delete other staff members' documents (matches
  // `AuditLog`/`AuthToken`'s "who did this" FK pattern).
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploaded_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
