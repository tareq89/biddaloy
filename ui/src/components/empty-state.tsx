/**
 * `explanation` and `action` are both required, non-optional props — an
 * empty state that only says "No data" is a dead end, one that says "No
 * fee structures yet. Create one to start generating monthly fees" teaches
 * the product. Omitting either is a type error, not a lint warning: there
 * is no default that would be honest for either field.
 */
import * as React from 'react';

import { Button } from './button';

export interface EmptyStateProps {
  title: string;
  explanation: string;
  action: { label: string; onClick: () => void };
  icon?: React.ReactNode;
}

export function EmptyState({ title, explanation, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{explanation}</p>
      <Button type="button" onClick={action.onClick} className="mt-2">
        {action.label}
      </Button>
    </div>
  );
}
