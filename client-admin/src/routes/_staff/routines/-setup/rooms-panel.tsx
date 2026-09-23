/**
 * [21.7.1] "Rooms" panel — building/room_no/capacity, same small-list
 * pattern as `ShiftsPanel`. Deleting a room still referenced by a routine
 * slot surfaces the server's 409 refusal (`RoomsService.remove`) and its
 * slot count verbatim.
 */
import { Button, Input, Label } from '@biddaloy/ui/components';
import { useCreateRoom, useDeleteRoom, useRooms, type Room } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

export function RoomsPanel() {
  const { t } = useTranslation('routines');
  const roomsQuery = useRooms();
  const createRoom = useCreateRoom();
  const deleteRoom = useDeleteRoom();

  const [building, setBuilding] = React.useState('');
  const [roomNo, setRoomNo] = React.useState('');
  const [capacity, setCapacity] = React.useState('');

  const rooms = roomsQuery.data?.data ?? [];

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    createRoom.mutate(
      {
        building: building === '' ? null : building,
        room_no: roomNo,
        capacity: capacity === '' ? null : Number(capacity),
      },
      { onSuccess: () => setRoomNo('') },
    );
  }

  function handleDelete(room: Room) {
    deleteRoom.mutate(room.id);
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">{t('roomsPanel.legend')}</h2>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 font-normal">{t('roomsPanel.building')}</th>
            <th className="py-1.5 font-normal">{t('roomsPanel.roomNo')}</th>
            <th className="py-1.5 font-normal">{t('roomsPanel.capacity')}</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id} className="border-b">
              <td className="py-1.5">{room.building ?? '—'}</td>
              <td className="py-1.5">{room.room_no}</td>
              <td className="py-1.5">{room.capacity ?? '—'}</td>
              <td className="py-1.5 text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(room)}
                >
                  {t('delete.action')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleAdd}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="room-building">{t('roomsPanel.building')}</Label>
          <Input
            id="room-building"
            value={building}
            onChange={(event) => setBuilding(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="room-no">{t('roomsPanel.roomNo')}</Label>
          <Input
            id="room-no"
            value={roomNo}
            onChange={(event) => setRoomNo(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="room-capacity">{t('roomsPanel.capacity')}</Label>
          <Input
            id="room-capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </div>
        <Button type="submit" loading={createRoom.isPending}>
          {t('roomsPanel.addAction')}
        </Button>
      </form>
      {createRoom.isError && <MutationErrorMessage error={createRoom.error} />}
      {deleteRoom.isError && <MutationErrorMessage error={deleteRoom.error} />}
    </section>
  );
}
