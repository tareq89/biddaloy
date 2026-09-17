import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PublicHolidaySet } from './public-holiday-set.entity';

/**
 * One holiday within a `PublicHolidaySet` (17.x). **Platform table: no
 * `tenant_id` by design (D10)** — same reasoning as `PublicHolidaySet`.
 */
@Entity('public_holiday_entries')
export class PublicHolidayEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PublicHolidaySet, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'set_id' })
  set: PublicHolidaySet;

  @Column({ type: 'uuid' })
  set_id: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name_bn: string | null;
}
