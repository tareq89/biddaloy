/**
 * [169.2-10] The widget seam (D38). A widget is one file
 * `widgets/<group>/<key>.widget.tsx` exporting `widgetKey` and a default
 * component. The key is the file name (D37), so the glob stays lazy and
 * wave-3 tickets add files without touching a shared list.
 */
import type { DashboardWidgetKey, WidgetSize } from '@biddaloy/shared';
import * as React from 'react';

export interface WidgetProps {
  variant: 'full' | 'compact' | 'tile';
  size: WidgetSize;
  config?: Record<string, unknown>;
}

const modules = import.meta.glob<{ default: React.ComponentType<WidgetProps> }>('./*/*.widget.tsx');

export const WIDGET_COMPONENTS = new Map<DashboardWidgetKey, React.ComponentType<WidgetProps>>(
  Object.entries(modules).map(([path, load]) => [
    path.split('/').pop()!.replace('.widget.tsx', '') as DashboardWidgetKey,
    React.lazy(load),
  ]),
);
