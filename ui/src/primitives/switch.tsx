'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from './lib/utils';

function Switch({
  className,
  checked,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      // Same `exactOptionalPropertyTypes` spread as `primitives/checkbox.tsx`.
      {...(checked === undefined ? {} : { checked })}
      className={cn(
        // The `after:` pseudo-element is the same ≥ 44 px touch target the checkbox uses.
        'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none after:absolute after:-inset-x-[var(--target-inset,0.75rem)] after:-inset-y-[var(--target-inset,0.5rem)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input md:h-5 md:w-9',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-background shadow-e1 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 md:size-4 md:data-[state=checked]:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
