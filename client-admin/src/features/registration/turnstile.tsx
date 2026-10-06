import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** No key → no widget (local dev and e2e); the server only checks the token when it has a secret. */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

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

// The in-flight load, shared so a second mount (StrictMode, a captcha reset) does not add the
// script twice. Reset on failure so a later mount can try again.
let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: TurnstileApi }).turnstile);
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('turnstile script failed'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Gives the form a token via `onToken` (`null` once it expires). Renders nothing without a site key.
 * If the script cannot load (blocked, offline) it says so in place, instead of the form only
 * complaining about a missing check on submit.
 */
export function Turnstile({
  onToken,
  siteKey = TURNSTILE_SITE_KEY,
}: {
  onToken: (token: string | null) => void;
  /** Defaults to the build's key; a story passes one to show the widget's states. */
  siteKey?: string | undefined;
}) {
  const { t } = useTranslation('register');
  const ref = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const onTokenRef = React.useRef(onToken);
  onTokenRef.current = onToken;

  React.useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | undefined;
    let api: TurnstileApi | undefined;
    let cancelled = false;
    const el = ref.current;
    loadScript()
      .then((turnstile) => {
        if (cancelled) return;
        api = turnstile;
        widgetId = turnstile.render(el, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onTokenRef.current(null);
      });
    return () => {
      cancelled = true;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return (
    <div>
      <div ref={ref} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.captchaUnavailable')}
        </p>
      )}
    </div>
  );
}
