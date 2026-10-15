import { API_BASE_URL, type components } from '@biddaloy/ui/api';
import { i18n } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';

type DemoRolesResponse = components['schemas']['DemoRolesResponseDto'];
export type DemoRoleCard = DemoRolesResponse['cards'][number];

/** Kept across a sign-out by `useSignOutToLogin`, so `/login` does not ask again. */
export const DEMO_ROLES_KEY = ['demo-roles'] as const;

const OFF = { enabled: false, cards: [] as DemoRoleCard[], password: '' };

/**
 * Is this the demo school? Asks the public `GET /demo/roles` once per page load. `enabled:
 * false`, any error, or a dropped network all mean "not a demo": login must never block on it
 * (D20).
 *
 * In the demo, the `demo` translations load before this reports `enabled`. So a component that
 * renders only when `enabled` can call `useTranslation('demo')` without suspending, and a normal
 * school never downloads them.
 */
export function useDemoMode(): {
  enabled: boolean;
  cards: DemoRoleCard[];
  password: string;
} {
  const { data } = useQuery({
    queryKey: DEMO_ROLES_KEY,
    queryFn: async ({ signal }): Promise<DemoRolesResponse | null> => {
      try {
        const res = await fetch(`${API_BASE_URL}/demo/roles`, { signal });
        // Always read the body: an unread one leaves the request open in Chromium, so the page
        // never reaches network idle.
        const body = (await res.json().catch(() => null)) as DemoRolesResponse | null;
        if (!res.ok || !body?.enabled) return null;
        await i18n.loadNamespaces('demo');
        return body;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ? { enabled: true, cards: data.cards, password: data.password } : OFF;
}
