/**
 * The student checklist Card shared by the Enrol and Record modals: header row (label,
 * "n of m selected", select-all / clear-all) over kit checkbox rows. No inner scroll box —
 * the full-page modal scrolls.
 */
import { Button, Checkbox } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

export interface StudentPickItem {
  id: string;
  name: string;
  roll?: string | null | undefined;
}

export function StudentPickCard({
  label,
  items,
  selected,
  onToggle,
  onToggleAll,
  emptyText,
}: {
  label: string;
  items: StudentPickItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  emptyText: string;
}) {
  const { t } = useTranslation('programs');
  const regionConfig = useTenantRegionConfig();
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedCount = items.filter((item) => selected.has(item.id)).length;

  return (
    <section className="rounded-lg border border-border-subtle bg-surface shadow-e1">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-h3">{label}</h2>
          {items.length > 0 && (
            <p className="text-caption text-text-secondary">
              {t('dialogs.selectedCount', {
                selected: formatNumber(selectedCount, regionConfig),
                total: formatNumber(items.length, regionConfig),
              })}
            </p>
          )}
        </div>
        {items.length > 0 && (
          <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={onToggleAll}>
            {allSelected ? t('dialogs.clearAll') : t('dialogs.selectAll')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-text-secondary">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((item) => (
            <li key={item.id} className="px-4">
              <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => onToggle(item.id)}
                />
                <span className="font-medium">{item.name}</span>
                {item.roll && (
                  <span className="text-text-secondary">
                    {t('students.roll', {
                      roll: /^\d+$/.test(item.roll)
                        ? formatNumber(Number(item.roll), regionConfig)
                        : item.roll,
                    })}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
