/**
 * [25.7] step 2: assign or clear a room's invigilator. `invigilator_user_id`
 * (D8) points at a `User`, not a `Teacher` — `useUsers({ role: 'TEACHER' })`
 * matches the entity's own `ManyToOne -> User` relation
 * (`seat-allocation.entity.ts`) rather than the separate teachers list.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useUpdateInvigilator, useUsers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

const UNASSIGNED = '__unassigned__';

export interface InvigilatorPickerProps {
  planId: string;
  roomId: string;
  invigilatorUserId: string | null;
  disabled: boolean;
}

export function InvigilatorPicker({
  planId,
  roomId,
  invigilatorUserId,
  disabled,
}: InvigilatorPickerProps) {
  const { t } = useTranslation('seatPlansDetail');
  const teachersQuery = useUsers({ role: 'TEACHER', limit: 100 });
  const teachers = teachersQuery.data?.data ?? [];
  const updateInvigilator = useUpdateInvigilator(planId);

  function handleChange(value: string) {
    updateInvigilator.mutate({
      roomId,
      input: { invigilator_user_id: value === UNASSIGNED ? null : value },
    });
  }

  return (
    <Select
      value={invigilatorUserId ?? UNASSIGNED}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectTrigger aria-label={t('room.invigilatorLabel')} className="w-56">
        <SelectValue placeholder={t('room.invigilatorPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>{t('room.invigilatorNone')}</SelectItem>
        {teachers.map((teacher) => (
          <SelectItem key={teacher.id} value={teacher.id}>
            {teacher.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
