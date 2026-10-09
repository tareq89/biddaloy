import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { LessonDeliveryReason, LessonDeliveryStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { PeriodSlot } from '../../routines/entities/period-slot.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [66.1.03/#2001] What actually happened in one period: taught, partly
 * taught, or not taught (with a reason). One row per (section, date, period).
 * The reason-iff-NOT_TAUGHT and no-extra-NOT_TAUGHT CHECKs live in
 * `1791500000000-StudyPlans.ts`, mirrored by `@Check` so `migration:generate`
 * does not drop them. No `deleted_at`: a correction is an update.
 *
 * Relations:
 * - @ManyToOne → School, ClassSection, Subject (CASCADE)
 * - @ManyToOne → PeriodSlot (RESTRICT): history is never wiped by a bell-schedule edit
 * - @ManyToOne → User (nullable, SET NULL): who recorded it
 */
@Entity('lesson_deliveries')
@Unique('UQ_lesson_deliveries_slot', ['tenant_id', 'section_id', 'date', 'period_slot_id'])
@Index('IDX_lesson_deliveries_plan_scope', ['tenant_id', 'section_id', 'subject_id', 'date'])
@Index('IDX_lesson_deliveries_tenant_date', ['tenant_id', 'date'])
@Check('CHK_lesson_deliveries_reason', `("status" = 'NOT_TAUGHT') = ("reason" IS NOT NULL)`)
@Check('CHK_lesson_deliveries_extra', `NOT "is_extra" OR "status" <> 'NOT_TAUGHT'`)
export class LessonDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => PeriodSlot, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'period_slot_id' })
  period_slot: PeriodSlot;

  @Column({ type: 'uuid' })
  period_slot_id: string;

  @Column({
    type: 'enum',
    enum: Object.values(LessonDeliveryStatus),
    enumName: 'lesson_deliveries_status_enum',
  })
  status: LessonDeliveryStatus;

  @Column({
    type: 'enum',
    enum: Object.values(LessonDeliveryReason),
    enumName: 'lesson_deliveries_reason_enum',
    nullable: true,
  })
  reason: LessonDeliveryReason | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'boolean', default: false })
  is_extra: boolean;

  @Column({ type: 'boolean', default: false })
  auto: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by_user_id' })
  recorded_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  recorded_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
