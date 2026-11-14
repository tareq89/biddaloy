import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { SeatOrder } from '../../billing/entities/seat-order.entity';
import { Coupon } from './coupon.entity';

/** One coupon use on one seat order (D25: `seat_order_id` is unique). Platform-owned; no tenant RLS. */
@Entity('coupon_redemptions')
@Unique('UQ_coupon_redemptions_order', ['seat_order_id'])
@Index('IDX_coupon_redemptions_coupon_school', ['coupon_id', 'school_id'])
@Check('CHK_coupon_redemptions_discount', '"discount_paisa" >= 0')
export class CouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Coupon, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id', foreignKeyConstraintName: 'FK_coupon_redemptions_coupon' })
  coupon: Coupon;

  @Column({ type: 'uuid' })
  coupon_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'school_id', foreignKeyConstraintName: 'FK_coupon_redemptions_school' })
  school: School;

  @Column({ type: 'uuid' })
  school_id: string;

  @ManyToOne(() => SeatOrder, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seat_order_id', foreignKeyConstraintName: 'FK_coupon_redemptions_order' })
  seat_order: SeatOrder;

  @Column({ type: 'uuid' })
  seat_order_id: string;

  // bigint comes back from pg as a string.
  @Column({ type: 'bigint' })
  discount_paisa: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
