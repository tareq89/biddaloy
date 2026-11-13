import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Coupon } from './coupon.entity';

/** The schools a SCHOOLS-scope coupon is for. Platform-owned; no tenant RLS. */
@Entity('coupon_schools')
export class CouponSchool {
  @ManyToOne(() => Coupon, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id', foreignKeyConstraintName: 'FK_coupon_schools_coupon' })
  coupon: Coupon;

  @PrimaryColumn({ type: 'uuid' })
  coupon_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'school_id', foreignKeyConstraintName: 'FK_coupon_schools_school' })
  school: School;

  @PrimaryColumn({ type: 'uuid' })
  school_id: string;
}
