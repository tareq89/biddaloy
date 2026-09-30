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
import { useUsers } from '@biddaloy/ui/hooks';

export interface StaffSelectProps {
  id: string;
  value: string;
  onValueChange: (id: string) => void;
  describedBy?: string;
}

export function StaffSelect({ id, value, onValueChange, describedBy }: StaffSelectProps) {
  // ponytail: first 100 staff only; swap for a search box if a school has more.
  const users = useUsers({ limit: 100 });
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        {...(describedBy ? { 'aria-invalid': true as const, 'aria-describedby': describedBy } : {})}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(users.data?.data ?? []).map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
