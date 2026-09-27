/**
 * Milestones tab — [34.4.1]. Clone of `-band-editor.tsx`'s inline-editable
 * list shape, adapted to an ordered list with ↑/↓ (mouse) and `Alt+↑/↓`
 * (keyboard, D9) reorder controls instead of a table. Remove asks first,
 * showing the `{{count}} achievements` the removal would also delete
 * (D23) — the count comes back on `GET /programs/:id`'s
 * `achievement_count` field.
 */
import { Button, Input, Textarea } from '@biddaloy/ui/components';
import {
  useAddMilestone,
  useRemoveMilestone,
  useReorderMilestones,
  useUpdateMilestone,
  type ProgramMilestone,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface MilestoneEditorProps {
  programId: string;
  milestones: ProgramMilestone[];
  /** [D5] Add/edit/remove/reorder require `PROGRAM_MANAGE` — a
   * `PROGRAM_RECORD`-only viewer (e.g. a teacher) sees the list read-only. */
  canManage: boolean;
}

export function MilestoneEditor({ programId, milestones, canManage }: MilestoneEditorProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');
  const addMilestone = useAddMilestone(programId);
  const updateMilestone = useUpdateMilestone(programId);
  const removeMilestone = useRemoveMilestone(programId);
  const reorderMilestones = useReorderMilestones(programId);

  const [addName, setAddName] = React.useState('');
  const [addDescription, setAddDescription] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [pendingRemoveId, setPendingRemoveId] = React.useState<string | null>(null);

  const ordered = [...milestones].sort((a, b) => a.sequence - b.sequence);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const moved = next.splice(index, 1)[0];
    if (!moved) return;
    next.splice(target, 0, moved);
    reorderMilestones.mutate(next.map((m) => m.id));
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, 1);
    }
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!addName.trim()) return;
    addMilestone.mutate(
      { name: addName.trim(), description: addDescription.trim() ? addDescription.trim() : null },
      {
        onSuccess: () => {
          setAddName('');
          setAddDescription('');
        },
      },
    );
  }

  function startEdit(milestone: ProgramMilestone) {
    setEditingId(milestone.id);
    setEditName(milestone.name);
    setEditDescription(milestone.description ?? '');
  }

  function handleEditSave(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId || !editName.trim()) return;
    updateMilestone.mutate(
      {
        milestoneId: editingId,
        input: {
          name: editName.trim(),
          description: editDescription.trim() ? editDescription.trim() : null,
        },
      },
      { onSuccess: () => setEditingId(null) },
    );
  }

  const pendingRemove = ordered.find((m) => m.id === pendingRemoveId);

  return (
    <div className="flex flex-col gap-3">
      {ordered.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('milestones.emptyHint')}</p>
      )}

      <ul className="flex flex-col gap-2" aria-label={t('detail.tabs.milestones')}>
        {ordered.map((milestone, index) => (
          <li
            key={milestone.id}
            className="flex items-start gap-2 rounded-md border border-border p-3"
          >
            {canManage && (
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={t('milestones.moveUp')}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className="disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t('milestones.moveDown')}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className="disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            )}

            {canManage && editingId === milestone.id ? (
              <form onSubmit={handleEditSave} className="flex flex-1 flex-col gap-2">
                <Input
                  aria-label={t('milestones.add')}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="submit" loading={updateMilestone.isPending}>
                    {tCommon('actions.save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                    {tCommon('actions.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-1 flex-col gap-1">
                <p className="font-medium">{milestone.name}</p>
                {milestone.description && (
                  <p className="text-sm text-muted-foreground">{milestone.description}</p>
                )}
                {canManage && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary underline"
                      onClick={() => startEdit(milestone)}
                    >
                      {t('milestones.edit')}
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-destructive underline"
                      onClick={() => setPendingRemoveId(milestone.id)}
                    >
                      {t('milestones.remove')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canManage && pendingRemove && (
        <div
          role="alertdialog"
          className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3"
        >
          <p className="text-sm">
            {t('milestones.removeConfirm', { count: pendingRemove.achievement_count ?? 0 })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              loading={removeMilestone.isPending}
              onClick={() =>
                removeMilestone.mutate(pendingRemove.id, {
                  onSuccess: () => setPendingRemoveId(null),
                })
              }
            >
              {t('milestones.remove')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPendingRemoveId(null)}>
              {tCommon('actions.cancel')}
            </Button>
          </div>
        </div>
      )}

      {canManage && (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 border-t border-border pt-3">
          <Input
            aria-label={t('milestones.add')}
            placeholder={t('milestones.add')}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
          <Textarea
            placeholder={t('formDialog.descriptionLabel')}
            value={addDescription}
            onChange={(e) => setAddDescription(e.target.value)}
          />
          <Button type="submit" loading={addMilestone.isPending}>
            {t('milestones.add')}
          </Button>
        </form>
      )}
    </div>
  );
}
