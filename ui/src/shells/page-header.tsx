/**
 * D16: page title, subtitle and action row. Stub — filled in by 31.2.5 (More
 * menu, the 1 primary + 2 outline limit, the phone row).
 */
import type * as React from 'react';

import { Button } from '../components/button';

import type { DetailShellAction } from './detail-shell';

export type PageAction = DetailShellAction & {
  icon?: React.ReactNode;
  /** Stays visible, not clickable (e.g. Save with no changes). */
  disabled?: boolean;
  /** Button `loading`. */
  busy?: boolean;
};

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: PageAction[];
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const visible = (actions ?? []).filter((action) => action.allowed !== false);
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
      <div>
        <h1 className="text-h1">{title}</h1>
        {subtitle && <p className="mt-0.5 text-text-secondary">{subtitle}</p>}
      </div>
      {visible.length > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          {visible.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant={action.priority === 'primary' ? 'default' : 'outline'}
              disabled={action.disabled ?? false}
              loading={action.busy ?? false}
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </header>
  );
}
