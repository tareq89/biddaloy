import { API_BASE_URL, type components } from '@biddaloy/ui/api';
import { useQuery } from '@tanstack/react-query';

type DemoRolesResponse = components['schemas']['DemoRolesResponseDto'];
export type DemoRoleCard = DemoRolesResponse['cards'][number];

const OFF = { enabled: false, cards: [] as DemoRoleCard[], password: '' };

/**
 * Is this the demo school? Asks the public `GET /demo/roles` once per page load. A 404 (not a
 * demo), any other error, or a dropped network all mean "not a demo": login must never block on
 * it (D20).
 */
export function useDemoMode(): {
  enabled: boolean;
  cards: DemoRoleCard[];
  password: string;
} {
  const { data } = useQuery({
    queryKey: ['demo-roles'],
    queryFn: async ({ signal }): Promise<DemoRolesResponse | null> => {
      try {
        const res = await fetch(`${API_BASE_URL}/demo/roles`, { signal });
        // Read the body even on a 404: an unread body leaves the request open in Chromium, so
        // the page never reaches network idle.
        const body: unknown = await res.json().catch(() => null);
        return res.ok ? (body as DemoRolesResponse) : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ? { enabled: true, cards: data.cards, password: data.password } : OFF;
}
