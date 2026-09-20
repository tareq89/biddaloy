import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Class } from '../../academics/entities/class.entity';
import { CalendarEvent } from './calendar-event.entity';

/**
 * Join table scoping a `CalendarEvent` to specific classes (17.x) — an
 * event with no rows here is visible to every class in the tenant.
 * Composite PK `(event_id, class_id)`; both FKs cascade on delete.
 *
 * The DB-level FK on `event_id` is actually composite —
 * `(event_id, tenant_id) REFERENCES calendar_events(id, tenant_id)`, see
 * the migration — so a row can never point at another tenant's event even
 * if application code somehow got `tenant_id` wrong. TypeORM's
 * `@JoinColumn` below still only names `event_id`; that's fine, every
 * write already sets both columns from the same tenant context, this is
 * just a defense-in-depth constraint the entity metadata doesn't need to
 * know about to keep working.
 */
@Entity('calendar_event_classes')
@Index(['tenant_id', 'class_id'])
export class CalendarEventClass {
  @ManyToOne(() => CalendarEvent, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: CalendarEvent;

  @PrimaryColumn({ type: 'uuid' })
  event_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @PrimaryColumn({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;
}
