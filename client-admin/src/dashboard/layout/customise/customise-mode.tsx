/**
 * [169.2-11] `/dashboard?customize=1`: a preview of the draft layout beside a
 * panel to show / hide / reorder / resize widgets. Save PATCHes the active
 * role's layout (D9, D34); Cancel and Esc leave without saving.
 */
import {
  ROLE_DEFAULT_LAYOUTS,
  WIDGET_CATALOGUE,
  type DashboardWidgetKey,
  type UserRole,
} from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import { hasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PencilIcon } from 'lucide-react';
import * as React from 'react';

import { resolveLayout } from '../resolve-layout';
import { useDashboardPrefs, useSaveDashboardPrefs } from '../use-dashboard-prefs';

import { customiseReducer, toPref, type DraftState } from './customise-draft';
import { CustomisePanel } from './customise-panel';
import { CustomisePreview } from './customise-preview';

function seed(role: UserRole, pref: Parameters<typeof resolveLayout>[0]['pref']): DraftState {
  const { visible, hidden } = resolveLayout({
    role,
    pref,
    catalogue: WIDGET_CATALOGUE,
    defaults: ROLE_DEFAULT_LAYOUTS,
    can: (p) => hasPermission(role, p),
  });
  return { shown: visible, hidden };
}

export function CustomiseMode({ role, onDone }: { role: UserRole; onDone: () => void }) {
  const { t } = useTranslation('dashboard');
  const { pref } = useDashboardPrefs();
  const save = useSaveDashboardPrefs();
  const [draft, dispatch] = React.useReducer(customiseReducer, undefined, () => seed(role, pref));
  const [focused, setFocused] = React.useState<DashboardWidgetKey | null>(null);

  const onSave = () =>
    save.mutate(toPref(draft), {
      onSuccess: () => {
        toast.success(t('customise.saved'));
        onDone();
      },
    });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-secondary px-3 py-1 text-label">
          <PencilIcon aria-hidden="true" className="size-4" />
          {t('customise.badge')}
        </span>
        <p className="text-text-secondary">{t('customise.intro')}</p>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <CustomisePreview shown={draft.shown} focusedKey={focused} />
        </div>
        <div className="xl:col-span-5">
          <CustomisePanel
            draft={draft}
            role={role}
            onAction={dispatch}
            onSave={onSave}
            onCancel={onDone}
            onReset={() => dispatch({ type: 'reset', defaults: seed(role, undefined) })}
            saving={save.isPending}
            error={save.error}
            onFocusRow={setFocused}
          />
        </div>
      </div>
    </div>
  );
}
