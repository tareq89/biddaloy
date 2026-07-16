import {
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
  FeeStatus,
  InvoiceStatus,
} from '../enums';

/**
 * Represents a single fee period's line item for payment forms.
 * Consumed by both DynamicFeePaymentForm and useFeePaymentStore.
 */
export interface FeeLineItem {
  student_fee_id: string;
  month_name: string;
  month: number;
  year: number;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  allocated_amount: number;
  allocation_type: PaymentAllocationType;
  locked: boolean;
}

/**
 * Summary of a student's fee dues returned by the payment info endpoint.
 */
export interface PaymentDueSummary {
  student_id: string;
  student_name: string;
  class_name: string;
  section_name: string;
  previous_dues: FeeLineItem[];
  current_month: FeeLineItem | null;
  advance_available_months: Array<{
    month: number;
    year: number;
    month_name: string;
    expected_amount: number;
  }>;
  summary: {
    total_dues: number;
    current_due: number;
    total_outstanding: number;
    min_payable: number;
  };
}

/**
 * Payload submitted by the fee payment form to the API.
 * Aligned with RecordPaymentWithAllocationDto and the Payment entity.
 */
export interface PaymentSubmissionData {
  student_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  allocations: Array<{
    student_fee_id: string;
    allocated_amount: number;
    allocation_type: PaymentAllocationType;
  }>;
  /** Optional notes attached to the payment (maps to Payment.remarks) */
  remarks?: string;
  create_advance_fees?: Array<{
    month: number;
    year: number;
    amount: number;
  }>;
  generate_invoice?: boolean;
}

// ---------------------------------------------------------------------------
// Response DTO types — replace any-based PaymentResponse fields.
// These mirror the server entity shapes for serialized API responses.
// ---------------------------------------------------------------------------

/**
 * Serialized fee returned as part of a payment response.
 * Matches StudentFee entity fields without TypeORM decorators.
 */
export interface StudentFeeResponse {
  id: string;
  student_id: string;
  academic_year_id: string;
  month: number;
  year: number;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  status: FeeStatus;
  due_date: string | null;
  is_advance_payment: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Serialized payment allocation returned in a payment response.
 * Matches PaymentAllocation entity fields without TypeORM decorators.
 */
export interface PaymentAllocationResponse {
  id: string;
  payment_id: string;
  student_fee_id: string;
  allocated_amount: number;
  allocation_type: PaymentAllocationType;
  notes: string | null;
  created_at: string;
  student_fee?: StudentFeeResponse;
}

/**
 * Serialized invoice returned as part of a payment response.
 * Matches Invoice entity — nullable exactly as defined by payment.entity.ts
 * where invoice: Invoice | null.
 */
export interface InvoiceResponse {
  id: string;
  invoice_number: string;
  student_id: string;
  student_fee_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string;
  line_items: Array<{
    description: string;
    amount: number;
    quantity: number;
    total: number;
  }> | null;
  issued_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Response returned by the payment recording endpoint.
 * All fields are now typed — no more `any`.
 */
export interface PaymentResponse {
  payment: {
    id: string;
    student_id: string;
    total_amount: number;
    payment_method: PaymentMethod;
    payment_status: PaymentStatus;
    transaction_reference: string | null;
    remarks: string | null;
    received_by_user_id: string | null;
    invoice_id: string | null;
    payment_date: string;
    created_at: string;
    updated_at: string;
  };
  allocations: PaymentAllocationResponse[];
  /** Nullable to match the Payment entity's invoice relation (Invoice | null) */
  invoice?: InvoiceResponse | null;
  updated_fees: StudentFeeResponse[];
}