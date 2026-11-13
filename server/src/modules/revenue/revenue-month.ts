import { BadRequestException } from '@nestjs/common';
import { startOfLocalDay, todayInSchoolTz } from '../../common/time';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface RevenueWindow {
  month: string;
  /** Inclusive: Dhaka midnight of the 1st. */
  start: Date;
  /** Exclusive: Dhaka midnight of the next month's 1st. */
  end: Date;
}

/** `YYYY-MM` (default: this month in `SCHOOL_TZ`) -> the half-open Dhaka-time window. */
export function revenueWindow(month?: string): RevenueWindow {
  const m = month ?? todayInSchoolTz().slice(0, 7);
  if (!MONTH_RE.test(m)) throw new BadRequestException('Invalid month');
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { month: m, start: startOfLocalDay(`${m}-01`), end: startOfLocalDay(`${next}-01`) };
}
