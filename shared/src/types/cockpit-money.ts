import type {
  ActionLineCode,
  CouponDiscountKind,
  CouponScope,
  SmsBundleOrderStatus,
  SmsLotSource,
  SmsLotStatus,
  SmsSource,
} from '../enums/cockpit-money';
import type { PlatformPaymentMethod, SeatOrderStatus } from '../enums/billing';
import type { SeatOrderDto } from './billing';

/** [Epic 100] One DTO per Wave 2-3 endpoint. Money is integer paisa (Rule 26); dates are ISO strings. */

// ---- SMS package catalog ----
export interface SmsBundleCatalogItemDto {
  id: string;
  name: string;
  sms_count: number;
  price_paisa: number;
  valid_days: number;
  active: boolean;
  created_at: string;
}
export interface SmsBundleCatalogWriteDto {
  name: string;
  sms_count: number;
  price_paisa: number;
  valid_days: number;
  active?: boolean;
}

// ---- Orders ----
export interface SmsBundleOrderDto {
  id: string;
  school_id: string;
  bundle_id: string;
  bundle_name: string;
  sms_count: number;
  amount_paisa: number;
  status: SmsBundleOrderStatus;
  method: PlatformPaymentMethod | null;
  receipt_number: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
}
export interface CreateSmsBundleOrderResponse {
  order: SmsBundleOrderDto;
  /** bKash checkout url to send the payer to. */
  redirect_url: string;
}

// ---- School summary ----
export interface SmsLotDto {
  id: string;
  source: SmsLotSource;
  status: SmsLotStatus;
  remaining: number;
  expiresAt: string | null;
  /** Expires inside the amber window. */
  soon: boolean;
}
export interface SmsCreditsSummaryExtrasDto {
  lots: SmsLotDto[];
  orders: SmsBundleOrderDto[];
  source: SmsSource;
  almostFinished: boolean;
}

// ---- Source ----
export interface SmsSourceDto {
  source: SmsSource;
  changed_at: string | null;
}
export interface SetSmsSourceRequest {
  source: SmsSource;
}

// ---- Stock ----
export interface SmsStockEntryDto {
  id: string;
  sms_count: number;
  note: string | null;
  recorded_by: string;
  created_at: string;
}
export interface RecordSmsStockRequest {
  sms_count: number;
  note?: string;
}
export interface SmsProviderBalanceDto {
  sms: number | null;
  kind: 'AUTO' | 'ENTERED' | 'UNKNOWN';
  enteredAt: string | null;
  stale: boolean;
}

// ---- Report ----
/** Server returns a code and params; the client writes the sentence (D15). */
export interface ActionLineDto {
  code: ActionLineCode;
  tone: 'danger' | 'warning' | 'neutral';
  params: Record<string, string | number>;
  target: { kind: 'tab'; tab: string } | { kind: 'school'; schoolId: string };
}
export interface SmsStatePackageRowDto {
  bundle_id: string;
  name: string;
  orders: number;
  sms_sold: number;
  amount_paisa: number;
}
export interface SmsStateSchoolRowDto {
  school_id: string;
  school_name: string;
  source: SmsSource;
  remaining: number;
  expiring_soon: number;
  low: boolean;
}
export interface SmsStateReportDto {
  actionLines: ActionLineDto[];
  balance: SmsProviderBalanceDto;
  sold_unused: number;
  packages: SmsStatePackageRowDto[];
  schools: SmsStateSchoolRowDto[];
}

// ---- Plans ----
export interface PlanDto {
  id: string;
  name: string;
  unit_price_paisa: number;
  active: boolean;
  created_at: string;
}
export interface SchoolPlanDto {
  school_id: string;
  plan_id: string | null;
  plan_name: string | null;
  unit_price_paisa: number;
  assigned_at: string | null;
}

// ---- Coupons ----
export interface CouponDto {
  id: string;
  code: string;
  kind: CouponDiscountKind;
  /** Percent (1-100) for PERCENT, paisa for FIXED. */
  value: number;
  scope: CouponScope;
  school_ids: string[];
  max_redemptions: number | null;
  redemptions: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}
export interface CouponWriteDto {
  code: string;
  kind: CouponDiscountKind;
  value: number;
  scope: CouponScope;
  school_ids?: string[];
  max_redemptions?: number | null;
  expires_at?: string | null;
  active?: boolean;
}
export interface CouponPreviewRequest {
  seats: number;
  months: number;
  coupon_code?: string;
  plan_id?: string;
}
export interface CouponPreviewResponse {
  listAmountPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
  /** Total is zero: the order is activated without payment. */
  free: boolean;
}
export interface CouponUsageRowDto {
  school_id: string;
  school_name: string;
  order_id: string;
  discount_paisa: number;
  redeemed_at: string;
}
export interface CouponUsageReportDto {
  coupon: CouponDto;
  total_discount_paisa: number;
  rows: CouponUsageRowDto[];
}

// ---- Refund ----
export interface RefundRequestDto {
  reason: string;
}
export interface RefundResultDto {
  order: SeatOrderDto;
  /** i18n key telling the owner to refund in the bKash panel. */
  instruction_key: string;
}

// ---- VAT ----
export interface VatSettingDto {
  /** Basis points: 1500 = 15%. */
  rate_bps: number;
  changed_at: string | null;
}

// ---- Revenue ----
export interface RevenueReportDto {
  from: string;
  to: string;
  seat_paisa: number;
  sms_paisa: number;
  discount_paisa: number;
  refunded_paisa: number;
  vat_paisa: number;
  net_paisa: number;
}

// ---- Order preview (Waves 3 to 5) ----
export interface OrderPreviewRequest {
  seats: number;
  months: number;
  coupon_code?: string;
}
export type OrderPreviewResponse = CouponPreviewResponse & {
  unit_price_paisa: number;
  status: SeatOrderStatus;
};
