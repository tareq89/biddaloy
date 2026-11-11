import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { clearEnrolHandoff, readEnrolHandoff } from '../features/cockpit/sign-in/enrol-handoff';
import { TwoStepWizard } from '../features/cockpit/two-step/two-step-wizard';
import { loadRouteNamespaces } from '../route-loaders';

/**
 * [98.4.04] First-time owner two-step set-up. Outside `_platform` on purpose: the owner has no
 * session yet (`__root.tsx` lists this path as public), so it works from the sign-in hand-off
 * alone. The hand-off is read once and cleared; a refresh shows "start again".
 */
export const Route = createFileRoute('/owner-security/two-step')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('ownerSecurity', 'common'),
  component: TwoStepRoute,
});

export function TwoStepRoute() {
  const navigate = useNavigate();
  const [handoff] = React.useState(readEnrolHandoff);
  React.useEffect(() => clearEnrolHandoff(), []);
  return (
    <TwoStepWizard
      handoff={handoff}
      onDone={() => void navigate({ to: '/schools' })}
      onStartAgain={() => void navigate({ to: '/sign-in' as '/' })}
    />
  );
}
