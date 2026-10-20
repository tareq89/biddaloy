import { useCreateSeatOrder } from '@biddaloy/ui/hooks';

import { BuySeatsDialog, type BuySeatsDialogProps } from './BuySeatsDialog';

/** `BuySeatsDialog` wired to `POST /billing/orders`. Used by Settings and by the seat-limit error. */
export function BuySeatsFlow(
  props: Omit<BuySeatsDialogProps, 'onSubmit' | 'pending' | 'failed' | 'created'>,
) {
  const create = useCreateSeatOrder();
  return (
    <BuySeatsDialog
      {...props}
      onOpenChange={(open) => {
        if (!open) create.reset();
        props.onOpenChange(open);
      }}
      pending={create.isPending}
      failed={create.isError}
      created={create.data}
      onSubmit={(input) => create.mutate(input)}
    />
  );
}
