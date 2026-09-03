/**
 * A `<dl>` of label/value pairs with a measure cap.
 *
 * Detail pages used to hand-roll `<dl className="grid grid-cols-2 …">`,
 * which on a 1440px screen pushed a label and its value ~300px apart with
 * ~700px of empty space to the right. `FieldGrid` caps the whole grid at
 * `max-w-4xl` and steps 1 → 2 → 3 columns, so a label and its value are
 * never more than one column apart. See §11.6 of
 * `docs/architecture/09-design-direction.md`.
 *
 * ```tsx
 * <FieldGrid>
 *   <Field label="Date of birth">{student.date_of_birth}</Field>
 * </FieldGrid>
 * ```
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

export interface FieldGridProps {
  children: React.ReactNode;
  className?: string;
}

export interface FieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FieldGrid({ children, className }: FieldGridProps) {
  return (
    <dl
      className={cn(
        'grid max-w-4xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Field({ label, children, className }: FieldProps) {
  return (
    <div className={className}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
