/**
 * [99.W5] Login as flow: idle -> waiting -> opened | idle. A blank tab is opened on the click itself
 * (popup blockers allow only that) and pointed at the school once the code arrives. The code
 * goes in the URL fragment, which browsers never send to a server or write to a log.
 *
 * A waiting request is watched through the owner's recent sessions. Once the school (or the other
 * owner) approves it, `openApproved` redeems it with its ticket id on a fresh click, which opens
 * the visit. A denied, ended or expired request is `over`: nothing is left to cancel.
 */
import {
  useEndLoginAs,
  useLoginAsSessions,
  useStartLoginAs,
  type StartImpersonationRequest,
} from '@biddaloy/ui/hooks';
import * as React from 'react';

export type LoginAsFlowState =
  | { kind: 'idle' }
  | { kind: 'waiting'; requestId: string; blocked: boolean; cancelFailed?: boolean }
  | { kind: 'opened' };

/** What the watched request is doing: still open, approved (can be opened) or over. */
export type WaitOutcome = 'pending' | 'approved' | 'over';

const WATCH_MS = 5_000;

/**
 * The school app host. #3757 was meant to add a helper in `cockpit-host.ts` but did not, so this
 * swaps the cockpit label for `app` on the same domain and port.
 * ponytail: confirm the real app host with the owner; a runtime-config key replaces this.
 */
export function appEnterUrl(
  code: string,
  loc: Pick<Location, 'protocol' | 'host'> = globalThis.location,
) {
  const host = loc.host.replace(/^cockpit/, 'app');
  return `${loc.protocol}//${host}/support/enter#code=${encodeURIComponent(code)}`;
}

export function useLoginAs(supportMode: 'allowed' | 'ask' | 'blocked' | undefined) {
  const start = useStartLoginAs();
  const end = useEndLoginAs();
  const [state, setState] = React.useState<LoginAsFlowState>({ kind: 'idle' });
  // Bumped on every submit and every dismissal: a reply for an older attempt is stale.
  const attempt = React.useRef(0);
  const tabRef = React.useRef<Window | null>(null);
  const lastInput = React.useRef<StartImpersonationRequest | null>(null);

  const requestId = state.kind === 'waiting' ? state.requestId : undefined;
  const watched = useLoginAsSessions(
    { scope: 'recent', limit: 100 },
    { enabled: !!requestId, refetchInterval: WATCH_MS },
  );
  const watchedStatus = watched.data?.find((s) => s.id === requestId)?.status;
  const outcome: WaitOutcome =
    watchedStatus === 'APPROVED'
      ? 'approved'
      : watchedStatus === 'DENIED' || watchedStatus === 'ENDED' || watchedStatus === 'EXPIRED'
        ? 'over'
        : 'pending';

  function closeTab() {
    tabRef.current?.close();
    tabRef.current = null;
  }

  function submit(input: StartImpersonationRequest) {
    const { ticketId: _ticket, ...rest } = input;
    lastInput.current = rest;
    const mine = ++attempt.current;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    tabRef.current = tab;
    // `mutateAsync`, not per-call callbacks: those are dropped when `reset` detaches the mutation,
    // and a dismissed attempt that already created a session must still be ended.
    start.mutateAsync({ ...input, ...(supportMode ? { supportMode } : {}) }).then(
      (result) => {
        if (mine !== attempt.current) {
          // Dismissed while the request was in flight: end what it made, open nothing.
          end.mutate({ id: result.kind === 'code' ? result.sessionId : result.requestId });
          return;
        }
        if (result.kind === 'code') {
          const url = appEnterUrl(result.code);
          if (tab) tab.location.href = url;
          else window.open(url, '_blank', 'noopener');
          tabRef.current = null;
          setState({ kind: 'opened' });
          return;
        }
        closeTab();
        setState({
          kind: 'waiting',
          requestId: result.requestId,
          blocked: result.kind === 'blocked-needs-owner',
        });
      },
      () => {
        if (mine === attempt.current) closeTab();
      },
    );
  }

  /** Redeem the approved request on this click (the tab must open on a user click). */
  function openApproved() {
    if (state.kind === 'waiting' && lastInput.current) {
      submit({ ...lastInput.current, ticketId: state.requestId });
    }
  }

  /** Ends the waiting request. Stays waiting, with `cancelFailed`, when the server refuses. */
  async function cancel(): Promise<boolean> {
    if (state.kind === 'waiting' && outcome !== 'over') {
      try {
        await end.mutateAsync({ id: state.requestId });
      } catch {
        setState((s) => (s.kind === 'waiting' ? { ...s, cancelFailed: true } : s));
        return false;
      }
    }
    setState({ kind: 'idle' });
    return true;
  }

  /** Dismiss: drop a pending start (closing its tab) and go back to the form. */
  function reset() {
    attempt.current++;
    closeTab();
    start.reset();
    setState({ kind: 'idle' });
  }

  return {
    state,
    outcome,
    submit,
    openApproved,
    cancel,
    reset,
    isPending: start.isPending,
    isError: start.isError,
  };
}
