/** [69.5.01] The group picker of the sticky footer: the school's own group names only. */
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface GroupSelectProps {
  groups: readonly string[];
  value: string;
  onChange: (value: string) => void;
}

export function GroupSelect({ groups, value, onChange }: GroupSelectProps) {
  const { t } = useTranslation('promotions');
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 md:max-w-56">
      <Label htmlFor="groups-footer-group">{t('groups.groupLabel')}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="groups-footer-group" className="h-11 w-full">
          <SelectValue placeholder={t('groups.groupPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group} value={group}>
              {group}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
