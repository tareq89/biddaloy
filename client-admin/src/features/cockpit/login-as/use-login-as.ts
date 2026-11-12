/**
 * [99.W5] Login as flow: idle -> waiting | opened. A blank tab is opened on the click itself
 * (popup blockers allow only that) and pointed at the school once the code arrives. The code
 * goes in the URL fragment, which browsers never send to a server or write to a log.
 */
import { useEndLoginAs, useStartLoginAs, type StartImpersonationRequest } from '@biddaloy/ui/hooks';
import * as React from 'react';

export type LoginAsFlowState =
  { kind: 'idle' } | { kind: 'waiting'; requestId: string; blocked: boolean } | { kind: 'opened' };

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

  function submit(input: StartImpersonationRequest) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    start.mutate(
      { ...input, ...(supportMode ? { supportMode } : {}) },
      {
        onSuccess: (result) => {
          if (result.kind === 'code') {
            const url = appEnterUrl(result.code);
            if (tab) tab.location.href = url;
            else window.open(url, '_blank', 'noopener');
            setState({ kind: 'opened' });
            return;
          }
          tab?.close();
          setState({
            kind: 'waiting',
            requestId: result.requestId,
            blocked: result.kind === 'blocked-needs-owner',
          });
        },
        onError: () => tab?.close(),
      },
    );
  }

  function cancel() {
    if (state.kind === 'waiting') end.mutate({ id: state.requestId });
    setState({ kind: 'idle' });
  }

  function reset() {
    start.reset();
    setState({ kind: 'idle' });
  }

  return { state, submit, cancel, reset, isPending: start.isPending, isError: start.isError };
}
