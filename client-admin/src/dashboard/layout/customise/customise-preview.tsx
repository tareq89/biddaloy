/**
 * [169.2-11] The draft as titled skeleton cards, using the same spans as the
 * real grid. Decorative: the panel is the accessible control.
 */
import type { DashboardWidgetKey } from '@biddaloy/shared';
import { Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { SIZE_CLASS } from '../dashboard-grid';
import type { LayoutItem } from '../resolve-layout';

export function CustomisePreview({
  shown,
  focusedKey,
}: {
  shown: LayoutItem[];
  focusedKey: DashboardWidgetKey | null;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 opacity-80">
      <p className="text-label text-muted-foreground">{t('customise.preview')}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
        {shown.map((item) => (
          <div
            key={item.key}
            data-focused={item.key === focusedKey || undefined}
            className={`${SIZE_CLASS[item.size]} flex h-28 flex-col gap-2 rounded-lg border bg-surface p-3 ${
              item.key === focusedKey ? 'border-primary ring-2 ring-ring' : 'border-border-subtle'
            }`}
          >
            <span className="truncate text-label">{t(`widgets.${item.key}.title`)}</span>
            <Skeleton className="w-full flex-1 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
