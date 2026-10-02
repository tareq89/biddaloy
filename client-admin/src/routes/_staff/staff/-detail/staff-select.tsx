/**
 * [28.4.2] Staff picker shared by the Start-ACR and Report-incident dialogs
 * when they are opened from the palette (no staff member in context).
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { Input } from '@biddaloy/ui/components';
import { useDebouncedValue, useUser, useUsers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface StaffSelectProps {
  id: string;
  value: string;
  onValueChange: (id: string) => void;
  describedBy?: string;
}

export function StaffSelect({ id, value, onValueChange, describedBy }: StaffSelectProps) {
  const { t } = useTranslation('evaluations');
  const [term, setTerm] = React.useState('');
  const search = useDebouncedValue(term.trim(), 300);
  const users = useUsers({ limit: 100, ...(search ? { search } : {}) });
  // Keep the chosen user selectable even when the search filters them out.
  const selected = useUser(value || undefined);
  const items = users.data?.data ?? [];
  const options =
    value && selected.data && !items.some((u) => u.id === value)
      ? [selected.data, ...items]
      : items;
  return (
    <>
      <Input
        aria-label={t('incident.staffSearch')}
        placeholder={t('incident.staffSearch')}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          id={id}
          {...(describedBy
            ? { 'aria-invalid': true as const, 'aria-describedby': describedBy }
            : {})}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
