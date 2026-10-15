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

/**
 * React.lazy caches a rejected import, so a chunk that failed once (e.g. a stale
 * tab after a deploy) would rethrow forever. On failure, swap in a fresh lazy
 * component so the card's Retry (a remount) imports again.
 */
export function retryableLazy(
  load: () => Promise<{ default: React.ComponentType<WidgetProps> }>,
): React.ComponentType<WidgetProps> {
  const make = (): React.ComponentType<WidgetProps> =>
    React.lazy(() =>
      load().catch((error: unknown) => {
        current = make();
        throw error;
      }),
    );
  let current = make();
  return function RetryableWidget(props: WidgetProps) {
    return React.createElement(current, props);
  };
}

export const WIDGET_COMPONENTS = new Map<DashboardWidgetKey, React.ComponentType<WidgetProps>>(
  Object.entries(modules).map(([path, load]) => [
    path.split('/').pop()!.replace('.widget.tsx', '') as DashboardWidgetKey,
    retryableLazy(load),
  ]),
);
