import { useQuery } from '@tanstack/react-query';

/** One `GET /demo/roles` card (server: `DemoRoleDto`). Typed here because the endpoint is public and fetched with plain `fetch`. */
export interface DemoRoleCard {
  key: string;
  role: string;
  email: string;
  branchSlug: string;
  nameEn: string;
  nameBn: string;
  tryKey: string;
}

interface DemoRolesResponse {
  password: string;
  cards: DemoRoleCard[];
}

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
        const res = await fetch('/api/v1/demo/roles', { signal });
        return res.ok ? ((await res.json()) as DemoRolesResponse) : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ? { enabled: true, cards: data.cards, password: data.password } : OFF;
}
