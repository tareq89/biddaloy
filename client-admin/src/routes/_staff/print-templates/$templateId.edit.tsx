/**
 * Full-screen template editor — [32.4.1]. `chromeless`: `_staff.tsx` renders it without the
 * sidebar and header (D54). Needs a wide screen (D34).
 */
import { createFileRoute } from '@tanstack/react-router';

import { DesktopOnlyGate } from '../../../components/print/desktop-only-gate';
import { TemplateEditor } from '../../../components/print/editor/template-editor';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/print-templates/$templateId/edit')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('printEditor', 'printTemplates', 'common'),
  component: EditTemplatePage,
});

function EditTemplatePage() {
  const { templateId } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <DesktopOnlyGate backTo="/print-templates">
      <TemplateEditor
        templateId={templateId}
        onExit={() => void navigate({ to: '/print-templates' })}
      />
    </DesktopOnlyGate>
  );
}
