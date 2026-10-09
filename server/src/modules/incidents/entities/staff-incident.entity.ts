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

export type StaffIncidentType = 'BEHAVIOUR' | 'ABSENCE' | 'COMPLAINT' | 'COMMENDATION' | 'OTHER';
export type StaffIncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** [28.1.2] A recorded incident about a staff member. Privacy-sensitive; no attachments (D15). */
@Entity('staff_incidents')
@Index('IDX_staff_incidents_tenant_staff', ['tenant_id', 'staff_user_id'])
export class StaffIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  staff_user_id: string;

  @Column({ type: 'varchar', length: 20 })
  type: StaffIncidentType;

  @Column({ type: 'varchar', length: 20 })
  severity: StaffIncidentSeverity;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'date' })
  occurred_on: string;

  @Column({ type: 'uuid' })
  reported_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
