/**
 * [67.2.04] One hook for every shell: the attention bar, its modal and the
 * bell's "needs your attention" section share one open flag (`?alerts=1`), so
 * the bar click, the bell and the Ctrl+K palette all open the same modal.
 */
import { AlertRecipientState } from '@biddaloy/shared';
import {
  AttentionBar,
  AttentionModal,
  type NotificationBellAttention,
} from '@biddaloy/ui/components';
import {
  useAttentionItems,
  useAttentionSummary,
  useHideAttentionItem,
  useMarkAttentionSeen,
  useSnoozeAttentionItem,
  type AlertItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { useLandingFlag } from '../../routes/_staff/-use-landing-flag';

/** `/path?a=1` -> router `to` + `search`, so query strings survive navigation. */
function splitUrl(url: string) {
  const [to = '/', query] = url.split('?');
  return { to, search: Object.fromEntries(new URLSearchParams(query)) };
}

export function useAttentionCenter({ todoTo }: { todoTo: string }) {
  const summary = useAttentionSummary();
  const [open, setOpen] = useLandingFlag('alerts', true);
  const navigate = useNavigate();
  const barRef = React.useRef<HTMLButtonElement>(null);
  const items = useAttentionItems({ tab: 'active', pageSize: 50 }, { enabled: open });
  const hide = useHideAttentionItem();
  const snooze = useSnoozeAttentionItem();
  const { t } = useTranslation('attention');
  const { mutate: markSeen } = useMarkAttentionSeen();

  const openItems = React.useMemo(
    () =>
      ((items.data?.items ?? []) as unknown as AlertItem[]).filter(
        (i) => i.state === AlertRecipientState.OPEN,
      ),
    [items.data],
  );
  // D24: report the open ids once per open.
  const seenSent = React.useRef(false);
  React.useEffect(() => {
    if (!open) seenSent.current = false;
    else if (items.data && !seenSent.current) {
      seenSent.current = true;
      if (openItems.length > 0) markSeen(openItems.map((i) => i.recipientId).slice(0, 100));
    }
  }, [open, items.data, openItems, markSeen]);

  // One failed or pending hide/snooze at a time: show it on that card only.
  const itemState: Record<string, { busy?: boolean; error?: string }> = {};
  for (const m of [hide, snooze]) {
    const id = typeof m.variables === 'string' ? m.variables : m.variables?.recipientId;
    if (id && m.isPending) itemState[id] = { busy: true };
    else if (id && m.isError) itemState[id] = { error: t('item.actionFailed') };
  }

  const todoHref = `${todoTo}?tab=active`;
  const data = summary.data;
  const bell: NotificationBellAttention = {
    count: data?.activeTotal ?? 0,
    topTitle: data?.top?.title ?? null,
    status: summary.isError ? 'error' : data ? 'ready' : 'loading',
    onRetry: () => void summary.refetch(),
    onOpen: () => setOpen(true),
    todoTo: todoHref,
  };

  const bar = (
    <AttentionBar
      summary={data}
      onOpen={() => setOpen(true)}
      buttonRef={barRef}
      className="mb-4 rounded-md"
    />
  );
  const modal = (
    <AttentionModal
      open={open}
      onOpenChange={setOpen}
      items={openItems}
      summary={data}
      loading={items.isPending}
      error={items.isError}
      onRetry={() => void items.refetch()}
      onPrimary={(item: AlertItem) => {
        setOpen(false);
        if (item.actionUrl) void navigate({ to: item.actionUrl } as never);
      }}
      onHide={(item) => hide.mutate(item.recipientId)}
      onSnooze={(item, choice, date) =>
        snooze.mutate({ recipientId: item.recipientId, choice, ...(date ? { date } : {}) })
      }
      itemState={itemState}
      todoHref={todoHref}
      todoCount={items.data?.total ?? 0}
      returnFocusRef={barRef}
      renderLink={(href, children) => {
        const { to, search } = splitUrl(href);
        return (
          <Link to={to} search={search as never} onClick={() => setOpen(false)}>
            {children}
          </Link>
        );
      }}
    />
  );
  return { bar, modal, bell };
}
