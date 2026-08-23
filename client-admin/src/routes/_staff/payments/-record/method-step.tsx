/**
 * Method, reference, remarks, and the "generate invoice on full payment"
 * toggle. That toggle only changes anything when `willFullyPay` is
 * true — `payment-allocation.service.ts`'s `recordWithAllocation` only
 * generates an invoice when every allocated fee reaches `PAID`, not
 * merely when the payment as a whole looks "full" — so the inline
 * explanation is conditioned on the same `willFullyPayAllTouchedFees`
 * result the wizard already computed for the running total.
 */
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export type PaymentMethodValue = 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'ONLINE' | 'CARD' | 'UPI';

const PAYMENT_METHODS: readonly PaymentMethodValue[] = [
  'CASH',
  'CHEQUE',
  'BANK_TRANSFER',
  'ONLINE',
  'CARD',
  'UPI',
];

export interface MethodStepProps {
  paymentMethod: PaymentMethodValue;
  onPaymentMethodChange: (method: PaymentMethodValue) => void;
  transactionReference: string;
  onTransactionReferenceChange: (value: string) => void;
  remarks: string;
  onRemarksChange: (value: string) => void;
  generateInvoice: boolean;
  onGenerateInvoiceChange: (value: boolean) => void;
  willFullyPay: boolean;
}

export function MethodStep({
  paymentMethod,
  onPaymentMethodChange,
  transactionReference,
  onTransactionReferenceChange,
  remarks,
  onRemarksChange,
  generateInvoice,
  onGenerateInvoiceChange,
  willFullyPay,
}: MethodStepProps) {
  const { t } = useTranslation('payments');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="record-payment-method" className="text-sm font-medium">
          {t('record.method.methodLabel')}
        </label>
        <Select
          value={paymentMethod}
          onValueChange={(value) => onPaymentMethodChange(value as PaymentMethodValue)}
        >
          <SelectTrigger id="record-payment-method" aria-label={t('record.method.methodLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((method) => (
              <SelectItem key={method} value={method}>
                {t(`record.method.methods.${method}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="record-payment-reference" className="text-sm font-medium">
          {t('record.method.referenceLabel')}
        </label>
        <Input
          id="record-payment-reference"
          value={transactionReference}
          onChange={(event) => onTransactionReferenceChange(event.target.value)}
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="record-payment-remarks" className="text-sm font-medium">
          {t('record.method.remarksLabel')}
        </label>
        <Textarea
          id="record-payment-remarks"
          value={remarks}
          onChange={(event) => onRemarksChange(event.target.value)}
          maxLength={1000}
        />
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="record-payment-generate-invoice"
          checked={generateInvoice}
          onCheckedChange={(checked) => onGenerateInvoiceChange(checked === true)}
        />
        <div className="flex flex-col gap-0.5">
          <label htmlFor="record-payment-generate-invoice" className="text-sm font-medium">
            {t('record.method.generateInvoiceLabel')}
          </label>
          <p className="text-xs text-muted-foreground">
            {willFullyPay
              ? t('record.method.generateInvoiceExplanationFull')
              : t('record.method.generateInvoiceExplanationPartial')}
          </p>
        </div>
      </div>
    </div>
  );
}
