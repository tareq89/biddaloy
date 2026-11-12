import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { clearEnrolHandoff, readEnrolHandoff } from '../sign-in/enrol-handoff';

import { TwoStepWizard } from './two-step-wizard';

/** The route's component; lives here so the route file exports only `Route` (code-splitting). */
export function TwoStepRoute() {
  const navigate = useNavigate();
  const [handoff] = React.useState(readEnrolHandoff);
  React.useEffect(() => clearEnrolHandoff(), []);
  return (
    <TwoStepWizard
      handoff={handoff}
      onDone={() => void navigate({ to: '/platform-owners' })}
      onStartAgain={() => void navigate({ to: '/sign-in' })}
    />
  );
}
