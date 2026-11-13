import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';
import { School } from '../../../schools/entities/school.entity';
import { SmsCreditLot } from './sms-credit-lot.entity';

/**
 * [100.1.02] One row per lot a reservation took units from. `open_units` is what is still
 * reserved (not yet debited or released).
 */
@Entity('sms_credit_lot_draws')
@Unique('UQ_sms_credit_lot_draws_key_lot', ['tenant_id', 'reserve_key', 'lot_id'])
@Index('IDX_sms_credit_lot_draws_key', ['tenant_id', 'reserve_key'])
@Check('CHK_sms_credit_lot_draws_units', '"units" > 0 AND "open_units" BETWEEN 0 AND "units"')
export class SmsCreditLotDraw {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => SmsCreditLot, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lot_id' })
  lot: SmsCreditLot;

  @Column({ type: 'uuid' })
  lot_id: string;

  @Column({ type: 'text' })
  reserve_key: string;

  @Column({ type: 'int' })
  units: number;

  @Column({ type: 'int' })
  open_units: number;
}
