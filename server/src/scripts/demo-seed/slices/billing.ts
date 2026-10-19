import { SeatOrder } from '../../../modules/billing/entities/seat-order.entity';
import { PlatformPayment } from '../../../modules/billing/entities/platform-payment.entity';
import type { DemoSlice } from '../context';

/** [49.4] Tables exist; the demo rows (paid and pending seat orders) are owed by #2184. */
export const slice: DemoSlice = {
  name: 'billing',
  covers: [SeatOrder, PlatformPayment],
  owedBy: '#2184',
  async run() {
    // Nothing yet: #2184 seeds the orders and deletes `owedBy`.
  },
};
