/**
 * [13.5.1] First-visit gate: an ADMIN whose school setup is not finished,
 * not dismissed and not yet `seen` lands in the welcome wizard once.
 *
 * `/` always redirects to `/dashboard`, so "the requested path is `/`" shows up
 * here as the dashboard. Any other path (a shared invoice, a deep link) is
 * never hijacked. Do-it-later / dismissed / finished / seen all stop the gate,
 * so the user is never trapped.
 */
import { UserRole, type OnboardingStatus } from '@biddaloy/shared';
import { onboardingStatusQueryOptions, useActiveRole } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import * as React from 'react';

export function shouldGoToWelcome(
  role: string | null | undefined,
  pathname: string,
  status: OnboardingStatus | undefined,
): boolean {
  if (role !== UserRole.ADMIN || !status) return false;
  if (pathname !== '/dashboard') return false;
  return !status.finished_at && !status.dismissed_at && !status.seen;
}

export function useWelcomeGate(): void {
  const role = useActiveRole();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useQuery({
    ...onboardingStatusQueryOptions(),
    enabled: role === UserRole.ADMIN,
  });
  const go = shouldGoToWelcome(role, pathname, data);
  React.useEffect(() => {
    // ponytail: cast until the /welcome route lands in routeTree (#1644) — drop it then.
    if (go) void navigate({ to: '/welcome' as never });
  }, [go, navigate]);
}
