import { createFileRoute, redirect } from '@tanstack/react-router';

// `/fees` → `/fees/dues` (D40)
export const Route = createFileRoute('/_staff/fees/')({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- same as every `throw redirect(...)`
    throw redirect({ to: '/fees/dues', replace: true });
  },
});
