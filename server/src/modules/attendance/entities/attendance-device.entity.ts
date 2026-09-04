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
import { School } from '../../schools/entities/school.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AttendanceDeviceKind, AttendanceDeviceStatus } from '@biddaloy/shared';

/**
 * A biometric/face/RFID reader ([9.5]) that can post attendance events for
 * a tenant.
 *
 * `token_hash` stores the SHA-256 hex digest of the device's 32-random-byte
 * key, not a bcrypt hash: the key is machine-generated, not a human
 * password, so a fast hash is correct here and lets the auth guard look a
 * device up by hash in one indexed query instead of bcrypt-comparing
 * against every row. `token_last4` is display-only, so an admin can tell
 * two devices apart in a list. The raw key itself is returned exactly once,
 * at creation — never again.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this device belongs to
 * - @ManyToOne → ClassSection (optional): section this device is bound to
 * - Referenced-by → AttendanceRecord: marks this device produced
 * - Referenced-by → AttendanceDeviceEvent: raw scans this device sent
 */
@Entity('attendance_devices')
@Index(['tenant_id'])
export class AttendanceDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'enum', enum: AttendanceDeviceKind })
  kind: AttendanceDeviceKind;

  @Column({ type: 'varchar', length: 64, unique: true })
  token_hash: string;

  @Column({ type: 'varchar', length: 4 })
  token_last4: string;

  @ManyToOne(() => ClassSection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection | null;

  @Column({ type: 'uuid', nullable: true })
  section_id: string | null;

  /** Face-recognition devices need the roster to match against; a
   * turnstile does not. Off unless deliberately granted. */
  @Column({ type: 'boolean', default: false })
  roster_access: boolean;

  @Column({ type: 'enum', enum: AttendanceDeviceStatus, default: AttendanceDeviceStatus.ACTIVE })
  status: AttendanceDeviceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
