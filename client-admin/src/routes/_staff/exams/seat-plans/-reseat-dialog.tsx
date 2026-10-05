/**
 * [25.7] step 3: move one student to a different room/seat.
 * `PATCH /seat-plans/:id/allocations/:allocationId` (#25.4) — 400
 * `SEAT_CAPACITY_SHORTFALL` (target room full) and 409 `SEAT_ALREADY_TAKEN`
 * both surface inline as translated lines (see `seat-plans.service.ts#updateAllocation`);
 * anything else is one generic line — never the server text.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useEditAllocation, type Room, type SeatPlanAllocationRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ReseatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  allocation: SeatPlanAllocationRow | null;
  rooms: Room[];
}

function roomLabel(room: Room): string {
  return room.building ? `${room.building} — ${room.room_no}` : room.room_no;
}

export function ReseatDialog({ open, onOpenChange, planId, allocation, rooms }: ReseatDialogProps) {
  const { t } = useTranslation('seatPlansDetail');
  const editAllocation = useEditAllocation(planId);
  const [roomId, setRoomId] = React.useState('');
  const [seatNumber, setSeatNumber] = React.useState('');

  React.useEffect(() => {
    if (allocation) {
      setRoomId(allocation.room_id);
      setSeatNumber(allocation.seat_number);
    }
  }, [allocation]);

  function handleOpenChange(next: boolean) {
    if (!next && editAllocation.isPending) return;
    if (!next) editAllocation.reset();
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!allocation || roomId === '' || seatNumber.trim() === '') return;
    editAllocation.mutate(
      { allocationId: allocation.id, input: { room_id: roomId, seat_number: seatNumber.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const errorCode =
    editAllocation.error instanceof ApiError
      ? (editAllocation.error.details as { code?: string } | undefined)?.code
      : undefined;
  const errorMessage = !editAllocation.error
    ? undefined
    : errorCode === 'SEAT_ALREADY_TAKEN'
      ? t('reseat.errorTaken')
      : errorCode === 'SEAT_CAPACITY_SHORTFALL'
        ? t('reseat.errorFull')
        : t('errors.unknown');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('reseat.title')}</DialogTitle>
          <DialogDescription>
            {allocation ? t('reseat.description', { name: allocation.student_name }) : ''}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reseat-room">{t('reseat.roomLabel')}</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger id="reseat-room" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {roomLabel(room)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reseat-seat">{t('reseat.seatNumberLabel')}</Label>
            <Input
              id="reseat-seat"
              inputMode="numeric"
              value={seatNumber}
              onChange={(event) => setSeatNumber(event.target.value)}
            />
          </div>

          {errorMessage !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              loading={editAllocation.isPending}
              disabled={roomId === '' || seatNumber.trim() === ''}
            >
              {t('reseat.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
