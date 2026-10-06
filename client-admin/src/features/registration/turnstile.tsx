import * as React from 'react';

/** No key → no widget (local dev and e2e); the server only checks the token when it has a secret. */
export const TURNSTILE_SITE_KEY: string | undefined = (
  import.meta.env as Record<string, string | undefined>
).VITE_TURNSTILE_SITE_KEY;

/** The server needs a non-empty token even when it will not check it. */
export const NO_CAPTCHA_TOKEN = 'no-captcha';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

function loadScript(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: TurnstileApi }).turnstile);
    script.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(script);
  });
}

/** Gives the form a token via `onToken` (`null` once it expires). Renders nothing without a site key. */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onTokenRef = React.useRef(onToken);
  onTokenRef.current = onToken;

  React.useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let widgetId: string | undefined;
    let api: TurnstileApi | undefined;
    let cancelled = false;
    const el = ref.current;
    loadScript()
      .then((turnstile) => {
        if (cancelled) return;
        api = turnstile;
        widgetId = turnstile.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (api && widgetId) api.remove(widgetId);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} />;
}
