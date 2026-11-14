import { Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage } from '@biddaloy/ui/shells';
import type * as React from 'react';

import { KindCards } from './modules-words/KindCards';
import { KindPreviewPage } from './modules-words/KindPreviewPage';
import { useInstitutionKinds } from './modules-words/use-institution-kinds';

export type ModulesWordsTab = 'modules' | 'words';

export interface ModulesWordsSectionProps {
  /** `?kind=`: the kind whose preview is open. */
  kindId: string | undefined;
  onKindChange: (id: string | undefined) => void;
  /** `?tab=`. */
  tab: ModulesWordsTab;
  onTabChange: (tab: ModulesWordsTab) => void;
  /** The Modules and Words panels arrive with 77.4.03-05; no tab bar until one is given. */
  modulesTab?: React.ReactNode;
  wordsTab?: React.ReactNode;
}

/**
 * D28/D29: Settings › Modules & words. The eight institution-kind cards on top (card, preview,
 * Apply), the Modules and Words tabs below. ADMIN only: the caller decides who sees it.
 */
export function ModulesWordsSection({
  kindId,
  onKindChange,
  tab,
  onTabChange,
  modulesTab,
  wordsTab,
}: ModulesWordsSectionProps) {
  const { t } = useTranslation('settings');
  const kinds = useInstitutionKinds();
  // Opening pushed `?kind=`, so closing goes Back; a deep link falls back to dropping the param.
  const close = useCloseFullPage(() => onKindChange(undefined));

  return (
    <div id="modules-words-section" className="space-y-6">
      <KindCards
        kinds={kinds.data}
        loading={kinds.isPending}
        error={kinds.isError}
        onRetry={() => void kinds.refetch()}
        selectedId={kindId}
        onSelect={onKindChange}
      />
      {(modulesTab || wordsTab) && (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v === 'words' ? 'words' : 'modules')}>
          <TabsList aria-label={t('modulesWords.tabs.label')}>
            <TabsTrigger value="modules">{t('modulesWords.tabs.modules')}</TabsTrigger>
            <TabsTrigger value="words">{t('modulesWords.tabs.words')}</TabsTrigger>
          </TabsList>
          <TabsContent value="modules">{modulesTab}</TabsContent>
          <TabsContent value="words">{wordsTab}</TabsContent>
        </Tabs>
      )}
      {kindId && <KindPreviewPage kindId={kindId} onClose={close} />}
    </div>
  );
}
