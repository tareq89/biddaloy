import type { DemoSlice } from '../context';
import { Alert } from '../../../modules/attention/entities/alert.entity';
import { AlertRecipient } from '../../../modules/attention/entities/alert-recipient.entity';

export const slice: DemoSlice = {
  name: 'attention',
  covers: [Alert, AlertRecipient],
  owedBy: '58.3.09',
  run: async () => {},
};
