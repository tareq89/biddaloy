/**
 * `explanation` and `action` are both required, non-optional props — an
 * empty state that only says "No data" is a dead end, one that says "No
 * fee structures yet. Create one to start generating monthly fees" teaches
 * the product. Omitting either is a type error, not a lint warning: there
 * is no default that would be honest for either field.
 *
 * `title` renders as an `<h1>` — [8.9.7]: every route in this app is
 * expected to have exactly one page-level heading for `useRouteFocus` to
 * find and focus after a navigation, and today `EmptyState` is what every
 * still-a-placeholder route (`/`, `/fees`, the 404 page) renders as its
 * entire content. Same visual size as before (no class change), only the
 * element changed.
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
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle p-8 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <h1 className="font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{explanation}</p>
      <Button type="button" onClick={action.onClick} className="mt-2">
        {action.label}
      </Button>
    </div>
  );
}
