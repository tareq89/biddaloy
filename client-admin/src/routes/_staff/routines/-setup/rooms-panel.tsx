/**
 * [21.7.1] "Rooms" panel — building/room_no/capacity. Deleting a room still
 * referenced by a routine slot is refused by the server's 409
 * (`RoomsService.remove`); [31.4] that is translated (`inUseError`), never
 * shown verbatim.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  HelpHint,
  Label,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCreateRoom,
  useDeleteRoom,
  useRooms,
  useUpdateRoom,
  type Room,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { DoorOpenIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

export function RoomsPanel() {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const roomsQuery = useRooms();
  const createRoom = useCreateRoom();
  const deleteRoom = useDeleteRoom();
  const [editing, setEditing] = React.useState<Room | null>(null);
  const updateRoom = useUpdateRoom(editing?.id ?? '');

  const [addOpen, setAddOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Room | null>(null);
  const [building, setBuilding] = React.useState('');
  const [roomNo, setRoomNo] = React.useState('');
  const [capacity, setCapacity] = React.useState('');
  const [saveFailed, setSaveFailed] = React.useState(false);

  const rooms = roomsQuery.data?.data ?? [];

  function openEdit(room: Room) {
    setEditing(room);
    setBuilding(room.building ?? '');
    setRoomNo(room.room_no);
    setCapacity(room.capacity != null ? String(room.capacity) : '');
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    setEditing(null);
    setBuilding('');
    setRoomNo('');
    setCapacity('');
    setSaveFailed(false);
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setSaveFailed(false);
    const body = {
      building: building === '' ? null : building,
      room_no: roomNo,
      capacity: capacity === '' ? null : Number(capacity),
    };
    const handlers = { onSuccess: closeAdd, onError: () => setSaveFailed(true) };
    if (editing) updateRoom.mutate(body, handlers);
    else createRoom.mutate(body, handlers);
  }

  function handleDelete() {
    if (!deleting) return;
    deleteRoom.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        toast.error(
          t(
            error instanceof ApiError && error.statusCode === 409
              ? 'roomsPanel.inUseError'
              : 'roomsPanel.deleteError',
          ),
        );
      },
    });
  }

  const columns: DataTableColumn<Room>[] = [
    {
      id: 'room',
      header: t('roomsPanel.roomNo'),
      card: 'title',
      accessorFn: (room) => (
        <>
          <span className="font-medium">{t('roomsPanel.roomName', { roomNo: room.room_no })}</span>
          <span className="block text-caption text-text-secondary md:hidden">
            {[
              room.building,
              room.capacity != null
                ? t('roomsPanel.capacityValue', { count: formatNumber(room.capacity, config) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </>
      ),
    },
    {
      id: 'building',
      header: t('roomsPanel.building'),
      card: 'hidden',
      accessorFn: (room) => room.building || '—',
    },
    {
      id: 'capacity',
      header: t('roomsPanel.capacity'),
      align: 'end',
      card: 'hidden',
      accessorFn: (room) =>
        room.capacity != null
          ? t('roomsPanel.capacityValue', { count: formatNumber(room.capacity, config) })
          : '—',
    },
  ];

  return (
    <Card padded={false} className="overflow-hidden">
      <section aria-label={t('roomsPanel.legend')}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:p-5">
          <div>
            <h2 className="text-h2">{t('roomsPanel.legend')}</h2>
            <p className="mt-1 text-text-secondary">{t('roomsPanel.subtitle')}</p>
          </div>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t('roomsPanel.addAction')}
          </Button>
        </div>

        <DataTable
          tableId="routine-rooms"
          caption={t('roomsPanel.caption')}
          columns={columns}
          data={rooms}
          getRowId={(room) => room.id}
          sorting={null}
          onSortingChange={() => {}}
          paginated={false}
          totalCount={rooms.length}
          loading={roomsQuery.isPending}
          rowActions={(room) => [
            { intent: 'edit', label: t('edit.action'), onClick: () => openEdit(room) },
            { intent: 'delete', label: t('delete.action'), onClick: () => setDeleting(room) },
          ]}
          emptyState={{
            icon: <DoorOpenIcon aria-hidden="true" />,
            title: t('roomsPanel.emptyTitle'),
            explanation: t('roomsPanel.emptyExplanation'),
          }}
        />
      </section>

      <Dialog open={addOpen} onOpenChange={(open) => (open ? setAddOpen(true) : closeAdd())}>
        <DialogContent size="sm">
          <form className="flex flex-col gap-4" onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>
                {t(editing ? 'roomsPanel.editTitle' : 'roomsPanel.dialogTitle')}
              </DialogTitle>
              <DialogDescription>{t('roomsPanel.subtitle')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="room-no">{t('roomsPanel.roomNo')}</Label>
                <HelpHint helpId="academics.routineSetup.field.roomNumber" />
              </div>
              <Input
                id="room-no"
                value={roomNo}
                onChange={(event) => setRoomNo(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-building">{t('roomsPanel.building')}</Label>
              <Input
                id="room-building"
                value={building}
                onChange={(event) => setBuilding(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-capacity">{t('roomsPanel.capacity')}</Label>
              <Input
                id="room-capacity"
                type="number"
                min={1}
                inputMode="numeric"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </div>
            {saveFailed && (
              <p role="alert" className="text-caption text-destructive">
                {t('roomsPanel.saveError')}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAdd}>
                {t('roomsPanel.cancel')}
              </Button>
              <Button type="submit" loading={createRoom.isPending || updateRoom.isPending}>
                {t(editing ? 'roomsPanel.editConfirm' : 'roomsPanel.dialogConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="danger"
        title={t('roomsPanel.deleteTitle', { roomNo: deleting?.room_no ?? '' })}
        description={t('roomsPanel.deleteDescription')}
        confirmLabel={t('roomsPanel.deleteConfirm')}
        cancelLabel={t('roomsPanel.cancel')}
        busy={deleteRoom.isPending}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
