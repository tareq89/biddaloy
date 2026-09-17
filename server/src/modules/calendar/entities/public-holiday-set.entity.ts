import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { PublicHolidaySource } from '@biddaloy/shared';
import { PublicHolidayEntry } from './public-holiday-entry.entity';

/**
 * One fetch of a country's public holidays for one calendar year (17.x) —
 * e.g. Bangladesh's 2026 holiday list from `NAGER_DATE`.
 *
 * **Platform table: no `tenant_id` by design (D10).** A public-holiday set
 * is shared across every tenant in the same country/year; a tenant opts
 * individual entries into its own calendar rather than owning a copy.
 *
 * Unique on `(country, year)` — one set per country per year.
 */
@Entity('public_holiday_sets')
@Unique(['country', 'year'])
export class PublicHolidaySet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ISO 3166-1 alpha-2, e.g. `'BD'`. */
  @Column({ type: 'char', length: 2 })
  country: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'varchar' })
  source: PublicHolidaySource;

  /** Null while the set is a draft fetch not yet published for tenants to
   * import from. */
  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'timestamptz' })
  fetched_at: Date;

  @OneToMany(() => PublicHolidayEntry, (entry) => entry.set)
  entries: PublicHolidayEntry[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
