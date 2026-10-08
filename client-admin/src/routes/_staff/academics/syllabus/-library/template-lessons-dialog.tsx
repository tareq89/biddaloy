/** Read-only lesson list of one library template, with "Copy to my plan" for SYLLABUS_MANAGE holders. */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Skeleton,
} from '@biddaloy/ui/components';
import { useStudyPlanTemplate } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

export function TemplateLessonsDialog({
  id,
  name,
  onClose,
  onCopy,
}: {
  id: string;
  name: string;
  onClose: () => void;
  /** Omitted for a viewer without SYLLABUS_MANAGE. */
  onCopy?: (() => void) | undefined;
}) {
  const { t } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const query = useStudyPlanTemplate(id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <ErrorState
            message={t('library.lessonsError')}
            retryLabel={tCommon('actions.retry')}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <ol className="max-h-[60vh] divide-y divide-border-subtle overflow-y-auto">
            {(query.data?.lessons ?? []).map((lesson, index) => (
              <li key={lesson.id} className="flex items-start gap-3 py-2">
                <span className="w-8 shrink-0 text-end text-text-secondary tabular-nums">
                  {formatNumber(index + 1, regionConfig)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{lesson.title}</p>
                  {lesson.notes && (
                    <p className="text-caption text-text-secondary">{lesson.notes}</p>
                  )}
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatNumber(lesson.periods, regionConfig)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tCommon('actions.close')}
            </Button>
          </DialogClose>
          {onCopy && (
            <Button type="button" onClick={onCopy}>
              {t('library.actions.copyToMine')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
