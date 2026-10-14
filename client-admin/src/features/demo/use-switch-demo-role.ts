import { logout } from '@biddaloy/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

/** Sign out, then land on `/login` (a signed-in visitor would be bounced off it). */
export function useSwitchDemoRole(): () => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return () => {
    void logout(queryClient).finally(() => void navigate({ to: '/login' }));
  };
}
