import type { UserRole } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
/** [52.5.2] History, tags and the comment box. Notes are plain text, never HTML. */
import {
  Button,
  Card,
  MultiCombobox,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@biddaloy/ui/components';
import {
  useApplicationTagOptions,
  useCommentOnApplication,
  useTagApplication,
  type ApplicationDto,
  type ApplicationEventDto,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { TFunction } from 'i18next';
import { SendIcon } from 'lucide-react';
import * as React from 'react';

type Translate = TFunction;

const TAG_CODES = ['APPLICATION_TAG_INVALID', 'APPLICATION_TAGS_STAFF_ONLY'];
function tagErrorKey(error: unknown): string {
  const code =
    error instanceof ApiError ? (error.details as { code?: string } | undefined)?.code : '';
  return code && TAG_CODES.includes(code) ? `activity.errors.${code}` : 'activity.tagFailed';
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function eventItem(e: ApplicationEventDto, app: ApplicationDto, t: Translate): TimelineItem {
  const actor = e.actor_name;
  const skipped =
    asList(e.data?.skipped_steps).length > 0 || asList(e.data?.auto_skipped).length > 0;
  // TAGGED carries `data.tags` = [{ user_id } | { role }]; names come from the application's tags.
  const names = asList(e.data?.tags)
    .map((x) => {
      const { user_id, role } = x as { user_id?: string; role?: string };
      const match = app.tags.find((tag) => (user_id ? tag.user_id === user_id : tag.role === role));
      return match?.user_name ?? (role ? t(`roles.${role}`) : '');
    })
    .filter(Boolean)
    .join(', ');
  const title = t(`events.${e.kind}`, { actor, n: (e.step ?? 0) + 1, names });
  const note = e.note;
  return {
    id: e.id,
    title: e.kind === 'COMMENT' ? actor : title,
    time: e.created_at,
    body:
      e.kind === 'COMMENT' ? (
        // Plain text: React escapes it, so a `<b>` shows as typed.
        <p className="rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">{note}</p>
      ) : (
        <>
          {skipped && <p className="text-text-secondary">{t('events.stepSkipped')}</p>}
          {note && (e.kind === 'REJECTED' || e.kind === 'CANCELLED') && (
            <p className="text-text-secondary">{t('activity.reason', { note })}</p>
          )}
        </>
      ),
  };
}

function TagEditor({ app }: { app: ApplicationDto }) {
  const { t } = useTranslation('applicationsDetail');
  const tag = useTagApplication();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const options = useApplicationTagOptions(q).data;
  const known = React.useRef(new Map<string, { value: string; label: string }>());

  const list = [
    ...(options?.users ?? []).map((u) => ({
      value: `user:${u.id}`,
      label: u.full_name,
      description: t(`roles.${u.role}`),
    })),
    ...(options?.roles ?? []).map((r) => ({ value: `role:${r}`, label: t(`roles.${r}`) })),
  ];
  for (const o of list) known.current.set(o.value, o);

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {t('activity.addTags')}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <MultiCombobox
        aria-label={t('activity.tagLabel')}
        options={list}
        value={picked}
        onValueChange={setPicked}
        selectedOptions={picked.flatMap((v) => known.current.get(v) ?? [])}
        // The list is fetched per typed text; the combobox keeps its own copy of the text.
        onInput={(e) => setQ(e.currentTarget.value)}
      />
      <p className="text-caption text-text-secondary">{t('activity.tagHelp')}</p>
      {tag.isError && (
        <p role="alert" className="text-caption text-destructive">
          {t(tagErrorKey(tag.error))}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={picked.length === 0}
        loading={tag.isPending}
        onClick={() =>
          tag.mutate(
            {
              id: app.id,
              tags: picked.map((v) =>
                v.startsWith('user:') ? { user_id: v.slice(5) } : { role: v.slice(5) as UserRole },
              ),
            },
            {
              onSuccess: () => {
                setPicked([]);
                setOpen(false);
              },
            },
          )
        }
      >
        {t('activity.addTags')}
      </Button>
    </div>
  );
}

function CommentBox({ app }: { app: ApplicationDto }) {
  const { t } = useTranslation('applicationsDetail');
  const comment = useCommentOnApplication();
  const [note, setNote] = React.useState('');
  const id = React.useId();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const text = note.trim();
        if (!text) return;
        comment.mutate({ id: app.id, note: text }, { onSuccess: () => setNote('') });
      }}
    >
      <label htmlFor={id} className="text-label">
        {t('activity.commentLabel')}
      </label>
      <Textarea
        id={id}
        rows={3}
        value={note}
        maxLength={2000}
        placeholder={t('activity.commentPlaceholder')}
        onChange={(e) => setNote(e.target.value)}
      />
      {comment.isError && (
        <p role="alert" className="text-caption text-destructive">
          {t('activity.commentFailed')}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        loading={comment.isPending}
        disabled={note.trim() === ''}
      >
        <SendIcon aria-hidden="true" />
        {t('activity.commentSend')}
      </Button>
    </form>
  );
}

export function ActivityPanel({ app }: { app: ApplicationDto }) {
  const { t } = useTranslation('applicationsDetail');
  const items = app.events.map((e) => eventItem(e, app, t));
  const tagged = app.tags
    .map((tag) => tag.user_name ?? (tag.role ? t(`roles.${tag.role}`) : ''))
    .join(', ');
  return (
    <Card padded className="space-y-4">
      <h2 className="text-h2">{t('activity.title')}</h2>
      <Timeline
        items={items}
        aria-label={t('activity.timelineLabel')}
        emptyText={t('activity.empty')}
      />
      {tagged && <p className="text-text-secondary">{t('activity.tagged', { names: tagged })}</p>}
      {app.can.comment && <TagEditor app={app} />}
      {app.can.comment && <CommentBox app={app} />}
    </Card>
  );
}
