/**
 * [169.2-10] Lays out widget slots only. Desktop/tablet: S/M/L spans in a
 * 1/2/4 column grid. Phone (D16): 2-column tiles for `phoneTile` widgets,
 * then compact cards for the rest. Plain CSS breakpoints, no JS media query.
 * A visible key with no component file yet renders nothing.
 */
import { WIDGET_CATALOGUE, type DashboardWidgetKey, type WidgetSize } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { WIDGET_COMPONENTS, type WidgetProps } from '../widgets/registry';

import type { LayoutItem } from './resolve-layout';
import { WidgetSlot } from './widget-slot';

/** S = 1 column, M = 2, L = 3 (shared with customise's preview). */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  S: '',
  M: 'md:col-span-2',
  L: 'md:col-span-2 xl:col-span-3',
};

export interface DashboardGridProps {
  visible: LayoutItem[];
  /** Test seam; defaults to the file-based registry. */
  components?: ReadonlyMap<DashboardWidgetKey, React.ComponentType<WidgetProps>>;
}

export function DashboardGrid({ visible, components = WIDGET_COMPONENTS }: DashboardGridProps) {
  const { t } = useTranslation('dashboard');
  const [openKey, setOpenKey] = React.useState<DashboardWidgetKey | null>(null);
  const items = visible.filter((i) => components.has(i.key));
  const render = (item: LayoutItem, variant: WidgetProps['variant']) => {
    const Widget = components.get(item.key)!;
    return (
      <WidgetSlot size={item.size}>
        <Widget variant={variant} size={item.size} />
      </WidgetSlot>
    );
  };

  const tiles = items.filter((i) => WIDGET_CATALOGUE[i.key].phoneTile);
  // An S tile is the whole widget on phone: no compact card, tap expands it.
  const tileOnly = (i: LayoutItem) => i.size === 'S' && WIDGET_CATALOGUE[i.key].phoneTile;
  const open = items.find((i) => i.key === openKey);

  return (
    <>
      <div
        data-testid="grid-desktop"
        className="hidden gap-4 md:grid md:grid-cols-2 md:gap-6 xl:grid-cols-4"
      >
        {items.map((item) => (
          <div key={item.key} className={SIZE_CLASS[item.size]}>
            {render(item, 'full')}
          </div>
        ))}
      </div>

      <div data-testid="grid-phone" className="flex flex-col gap-3 md:hidden">
        {tiles.length > 0 && (
          <section aria-label={t('page.keyNumbers')} className="grid grid-cols-2 gap-3">
            {tiles.map((item) =>
              tileOnly(item) ? (
                <button
                  key={item.key}
                  type="button"
                  aria-expanded={openKey === item.key}
                  onClick={() => setOpenKey(openKey === item.key ? null : item.key)}
                  className="min-h-11 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {render(item, 'tile')}
                </button>
              ) : (
                <div key={item.key}>{render(item, 'tile')}</div>
              ),
            )}
          </section>
        )}
        {open && <div data-testid="tile-expanded">{render(open, 'full')}</div>}
        {items
          .filter((i) => !tileOnly(i))
          .map((item) => (
            <div key={item.key}>{render(item, 'compact')}</div>
          ))}
      </div>
    </>
  );
}
