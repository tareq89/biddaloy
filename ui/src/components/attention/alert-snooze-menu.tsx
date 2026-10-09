/**
 * [67.2.05] "Remind me later" for a warning alert: three quick choices and a
 * date. Built on the kit `Menu`; the date choice opens a small dialog with the
 * kit `DatePicker`. The server accepts a snooze date from tomorrow to 30 days
 * ahead on the tenant's clock (67.1.07), so the picker is bounded the same way.
 */
import {
  AlarmClockIcon,
  CalendarIcon,
  CalendarPlusIcon,
  Clock2Icon,
  SunriseIcon,
} from 'lucide-react';
import * as React from 'react';

import type { SnoozeChoice } from '../../api/attention';
import { useRegionConfig, useTranslation } from '../../i18n';
import { parseDate, tenantTodayIso, toIsoDate } from '../../utils';
import { Button } from '../button';
import { DatePicker } from '../date-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../menu';
import { RowActionsLayoutContext } from '../row-actions';

export interface AlertSnoozeMenuProps {
  /** `date` is `YYYY-MM-DD` and only set for `'DATE'`. */
  onSelect: (choice: SnoozeChoice, date?: string) => void;
  /** Accessible name; defaults to the visible "Remind me later". */
  label?: string;
  /** `'icon'` shows the alarm-clock alone (but cards always show the label). */
  triggerVariant?: 'button' | 'icon';
  disabled?: boolean;
}

const QUICK = [
  ['TWO_HOURS', Clock2Icon],
  ['TOMORROW_MORNING', SunriseIcon],
  ['NEXT_SCHOOL_DAY', CalendarPlusIcon],
] as const;

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export function AlertSnoozeMenu({
  onSelect,
  label,
  triggerVariant = 'button',
  disabled = false,
}: AlertSnoozeMenuProps) {
  const { t } = useTranslation('attention');
  const config = useRegionConfig();
  const layout = React.useContext(RowActionsLayoutContext);
  const [dateOpen, setDateOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date | undefined>();
  const name = label ?? t('item.snooze');
  const iconOnly = triggerVariant === 'icon' && layout !== 'labelled';

  const today = parseDate(tenantTodayIso(config));
  const min = addDays(today, 1);
  const max = addDays(today, 30);

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          {iconOnly ? (
            <Button
              iconOnly
              aria-label={name}
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            >
              <AlarmClockIcon aria-hidden />
            </Button>
          ) : (
            <Button variant="ghost" disabled={disabled} className="min-h-11 md:min-h-0">
              <AlarmClockIcon aria-hidden />
              {name}
            </Button>
          )}
        </MenuTrigger>
        <MenuContent align="end">
          {QUICK.map(([choice, Icon]) => (
            <MenuItem key={choice} onSelect={() => onSelect(choice)}>
              <Icon aria-hidden />
              {t(`snooze.${choice}`)}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setDateOpen(true)}>
            <CalendarIcon aria-hidden />
            {t('snooze.DATE')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={dateOpen} onOpenChange={setDateOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('snooze.dateTitle')}</DialogTitle>
          </DialogHeader>
          <DatePicker
            aria-label={t('snooze.dateLabel')}
            value={date}
            onValueChange={setDate}
            config={config}
            min={min}
            max={max}
            clearable={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDateOpen(false)}>
              {t('snooze.cancel')}
            </Button>
            <Button
              disabled={!date}
              onClick={() => {
                if (!date) return;
                setDateOpen(false);
                onSelect('DATE', toIsoDate(date));
              }}
            >
              {t('snooze.dateSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
