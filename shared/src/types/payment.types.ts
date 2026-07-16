import { PaymentAllocationType, PaymentMethod } from '../enums';

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

/**
 * Response returned by the payment recording endpoint.
 * TODO: Replace `any` with explicit Payment, PaymentAllocation, Invoice,
 * StudentFee DTOs once those server response types are defined.
 */
export interface PaymentResponse {
  payment: any;
  allocations: any[];
  invoice?: any;
  updated_fees: any[];
}